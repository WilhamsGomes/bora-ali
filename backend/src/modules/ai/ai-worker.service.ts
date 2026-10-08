import { withFields } from '../../common/logging';
import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { AiAttemptStatus, AiJob, AiJobStatus, Prisma } from '@prisma/client';
import { toLocalDate } from '../../common/utils/local-date';
import { minutesToTime } from '../../common/utils/local-time';
import { AppConfig } from '../../config/app-config.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AiBudgetExhaustedError, AiCostService } from '../entitlements/ai-cost.service';
import { PLAN_FEATURES } from '../entitlements/plan-policy';
import { sortActivities } from '../itinerary/itinerary.mapper';
import {
  AiErrorCode,
  AiProvider,
  AiProviderError,
  AiTask,
  AttemptResult,
  ContextDay,
  OutputLimits,
  TripContext,
} from './ai-provider';
import { AiJobResult, normalizeAdjustment, normalizeSuggestions } from './ai-result';
import { jobInputSchema, ModelAdjustOutput, ModelSuggestionsOutput } from './ai.schemas';
import { buildUserPrompt, SYSTEM_PROMPT } from './prompts';

const POLL_INTERVAL_MS = 1_000;
/** Retomadas de um trabalho após queda do worker (não confundir com novas tentativas de chamada). */
const MAX_JOB_ATTEMPTS = 2;
const LEASE_MARGIN_MS = 60_000;

/** Mensagens exibidas ao usuário por código de falha do trabalho. */
export const AI_FAILURE_MESSAGES: Record<AiErrorCode, string> = {
  AI_REQUEST_REFUSED:
    'A IA não pôde atender a este pedido. Tente reformular o pedido ou ajuste o roteiro manualmente. Esta tentativa não consumiu sua cota.',
  AI_BUDGET_EXHAUSTED: 'O uso de IA desta viagem chegou ao limite. Você continua podendo editar o roteiro manualmente.',
  AI_TIMEOUT: 'A IA demorou demais para responder. Tente novamente em instantes; a cota não foi consumida.',
  AI_RATE_LIMITED: 'A IA está temporariamente sobrecarregada. Tente novamente mais tarde; a cota não foi consumida.',
  AI_PROVIDER_ERROR: 'Não foi possível gerar as sugestões agora. Tente novamente; a cota não foi consumida.',
  AI_UNAVAILABLE: 'A IA está indisponível no momento.',
  AI_INVALID_OUTPUT: 'A resposta da IA veio incompleta. Tente novamente; a cota não foi consumida.',
  AI_OUTPUT_TRUNCATED: 'O pedido gerou uma resposta grande demais. Tente com menos dias ou um pedido mais curto.',
  AI_WORKER_TIMEOUT: 'O processamento foi interrompido. Tente novamente; a cota não foi consumida.',
};

/** Falha do trabalho inteiro (encerra como FAILED e libera a cota funcional). */
class JobFailure extends Error {
  constructor(readonly code: AiErrorCode) {
    super(AI_FAILURE_MESSAGES[code]);
  }
}

interface CallContext {
  job: AiJob;
  callIndex: number;
}

/**
 * Processa a fila de AiJob guardada no PostgreSQL (FOR UPDATE SKIP LOCKED),
 * sem depender de conexão HTTP aberta. Pode rodar em vários processos.
 *
 * Por chamada ao provedor: reserva orçamento → chama uma vez → reconcilia custo.
 * Só erros transitórios ganham nova tentativa (limitada, com backoff e retry-after).
 * Recusas encerram o trabalho na hora, sem repetir e sem trocar de modelo.
 * Uma geração consome no máximo uma utilização (o trabalho), independentemente
 * do número de chamadas.
 */
@Injectable()
export class AiWorkerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(AiWorkerService.name);
  private timer?: NodeJS.Timeout;
  private stopping = false;
  private inFlight?: Promise<void>;
  /** Substituível nos testes. */
  sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: AiProvider,
    private readonly cost: AiCostService,
    private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap() {
    if (!this.config.get('RUN_WORKERS')) return;
    this.logger.log(`Worker de IA ativo (provedor: ${this.provider.name}, modelo: ${this.config.get('AI_MODEL')})`);
    this.schedule();
  }

  async onApplicationShutdown() {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    await this.inFlight;
  }

  private schedule() {
    if (this.stopping) return;
    this.timer = setTimeout(() => {
      this.inFlight = this.tick().finally(() => this.schedule());
    }, POLL_INTERVAL_MS);
  }

  private async tick() {
    try {
      await this.recoverAbandoned();
      while (!this.stopping && (await this.processNext())) {
        /* continua enquanto houver fila */
      }
    } catch (err) {
      this.logger.error(withFields('Falha no ciclo do worker de IA', { err: (err as Error).message }));
    }
  }

  /** Tempo máximo de uma chamada, incluindo a maior espera entre tentativas. */
  private get leaseMs(): number {
    return this.config.get('AI_TIMEOUT_MS') + this.config.get('AI_MAX_RETRY_WAIT_MS') + LEASE_MARGIN_MS;
  }

  /**
   * Retoma ou encerra trabalhos cujo worker caiu no meio. Encerrar libera a
   * cota. Chamadas que estavam em andamento ficam com custo UNKNOWN (a reserva
   * continua contando no orçamento: a chamada pode ter sido cobrada).
   */
  async recoverAbandoned(): Promise<void> {
    const recovered = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE "AiJob" SET
        "status" = CASE WHEN "attempts" < ${MAX_JOB_ATTEMPTS} THEN 'QUEUED'::"AiJobStatus" ELSE 'FAILED'::"AiJobStatus" END,
        "errorCode" = CASE WHEN "attempts" < ${MAX_JOB_ATTEMPTS} THEN NULL ELSE 'AI_WORKER_TIMEOUT' END,
        "errorMessage" = CASE WHEN "attempts" < ${MAX_JOB_ATTEMPTS} THEN NULL ELSE ${AI_FAILURE_MESSAGES.AI_WORKER_TIMEOUT} END,
        "finishedAt" = CASE WHEN "attempts" < ${MAX_JOB_ATTEMPTS} THEN NULL ELSE now() END,
        "lockedUntil" = NULL,
        "updatedAt" = now()
      WHERE "status" = 'RUNNING' AND "lockedUntil" < now()
      RETURNING "id"`;
    if (recovered.length) {
      await this.prisma.aiAttempt.updateMany({
        where: { jobId: { in: recovered.map((r) => r.id) }, status: AiAttemptStatus.RESERVED },
        data: { status: AiAttemptStatus.ABANDONED, costStatus: 'UNKNOWN', finishedAt: new Date() },
      });
    }
  }

  /** Reivindica e processa um trabalho. Retorna false se a fila estiver vazia. */
  async processNext(): Promise<boolean> {
    const claimed = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE "AiJob" SET
        "status" = 'RUNNING', "attempts" = "attempts" + 1, "startedAt" = now(),
        "lockedUntil" = now() + make_interval(secs => ${this.leaseMs / 1000}), "updatedAt" = now()
      WHERE "id" = (
        SELECT "id" FROM "AiJob" WHERE "status" = 'QUEUED'
        ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1
      )
      RETURNING "id"`;
    if (claimed.length === 0) return false;

    const job = await this.prisma.aiJob.findUniqueOrThrow({ where: { id: claimed[0].id } });
    await this.run(job);
    return true;
  }

  private async run(job: AiJob): Promise<void> {
    const started = Date.now();
    try {
      const result = await this.execute(job);
      const totals = await this.totals(job.id);
      // Consumo: só marca sucesso se o trabalho ainda for deste worker (uma utilização por trabalho).
      await this.prisma.aiJob.updateMany({
        where: { id: job.id, status: AiJobStatus.RUNNING },
        data: {
          status: AiJobStatus.SUCCEEDED,
          result: result as unknown as Prisma.InputJsonValue,
          ...totals,
          finishedAt: new Date(),
          lockedUntil: null,
        },
      });
      this.logger.log(withFields('Geração concluída', { jobId: job.id, kind: job.kind, ms: Date.now() - started, ...totals }));
    } catch (err) {
      const code: AiErrorCode = err instanceof JobFailure ? err.code : 'AI_PROVIDER_ERROR';
      const totals = await this.totals(job.id);
      // Falha libera a cota funcional (FAILED não conta); o custo já registrado nas tentativas permanece.
      await this.prisma.aiJob.updateMany({
        where: { id: job.id, status: AiJobStatus.RUNNING },
        data: {
          status: AiJobStatus.FAILED,
          errorCode: code,
          errorMessage: AI_FAILURE_MESSAGES[code],
          ...totals,
          finishedAt: new Date(),
          lockedUntil: null,
        },
      });
      this.logger.warn(withFields('Geração falhou; cota liberada', { jobId: job.id, kind: job.kind, code, err: err instanceof JobFailure ? undefined : (err as Error).message }));
    }
  }

  /** Consumo técnico agregado do trabalho (todas as tentativas, inclusive as que falharam). */
  private async totals(jobId: string) {
    const attempts = await this.prisma.aiAttempt.findMany({
      where: { jobId },
      orderBy: [{ callIndex: 'asc' }, { attemptNumber: 'asc' }],
      select: { inputTokens: true, outputTokens: true, model: true, provider: true },
    });
    const sum = (k: 'inputTokens' | 'outputTokens') =>
      attempts.some((a) => a[k] === null) ? null : attempts.reduce((n, a) => n + (a[k] ?? 0), 0);
    const last = attempts.at(-1);
    return {
      provider: last?.provider ?? this.provider.name,
      model: last?.model ?? null,
      inputTokens: attempts.length ? sum('inputTokens') : null,
      outputTokens: attempts.length ? sum('outputTokens') : null,
    };
  }

  private async execute(job: AiJob): Promise<AiJobResult> {
    const input = jobInputSchema.parse(job.input);
    const trip = await this.prisma.trip.findUnique({
      where: { id: job.tripId },
      include: { days: { include: { activities: true }, orderBy: { date: 'asc' } } },
    });
    if (!trip) throw new JobFailure('AI_PROVIDER_ERROR');
    if (!PLAN_FEATURES[trip.plan].ai) throw new JobFailure('AI_UNAVAILABLE');

    const maxContext = this.config.get('AI_MAX_CONTEXT_ACTIVITIES_PER_DAY');
    const limits: OutputLimits = {
      maxSuggestionsPerDay: this.config.get('AI_MAX_SUGGESTIONS_PER_DAY'),
      maxChanges: this.config.get('AI_MAX_ADJUST_CHANGES'),
    };
    const tripCtx: TripContext = {
      name: trip.name,
      destination: trip.destination,
      timeZone: trip.timeZone,
      stay: trip.stay,
      startDate: toLocalDate(trip.startDate),
      endDate: toLocalDate(trip.endDate),
    };
    const days = trip.days.map((d) => ({ id: d.id, date: toLocalDate(d.date), title: d.title, activities: sortActivities(d.activities) }));
    const toContext = (d: (typeof days)[number]): ContextDay => ({
      date: d.date,
      title: d.title,
      omittedActivities: Math.max(d.activities.length - maxContext, 0),
      activities: d.activities.slice(0, maxContext).map((a) => ({
        id: a.id,
        version: a.version,
        time: minutesToTime(a.startMinutes),
        title: a.title,
        category: a.category,
        durationMinutes: a.durationMinutes,
        location: a.location,
      })),
    });
    // Só atividades visíveis no contexto podem ser alvo de ajustes.
    const refs = days.map((d) => ({
      id: d.id,
      date: d.date,
      activities: d.activities.slice(0, maxContext).map((a) => ({ id: a.id, version: a.version })),
    }));
    const scopeOf = (ids?: string[]) => (ids?.length ? days.filter((d) => ids.includes(d.id)) : days);

    if (input.kind === 'ADJUST_ITINERARY') {
      const scope = scopeOf(input.dayIds);
      const out = await this.call<ModelAdjustOutput>(
        { job, callIndex: 0 },
        { type: 'adjust', trip: tripCtx, days: scope.map(toContext), instruction: input.instruction, limits },
      );
      return normalizeAdjustment(out, refs.filter((r) => scope.some((d) => d.id === r.id)), limits.maxChanges);
    }

    const scope = input.kind === 'DAY_SUGGESTIONS' ? days.filter((d) => d.id === input.dayId) : scopeOf(input.dayIds);
    if (scope.length === 0) throw new JobFailure('AI_PROVIDER_ERROR');
    const merged: ModelSuggestionsOutput = { suggestions: [], notes: [] };
    const perCall = this.config.get('AI_DAYS_PER_CALL');
    for (let i = 0, callIndex = 0; i < scope.length; i += perCall, callIndex++) {
      const chunk = scope.slice(i, i + perCall);
      const out = await this.call<ModelSuggestionsOutput>(
        { job, callIndex },
        { type: 'suggest', trip: tripCtx, days: chunk.map(toContext), preferences: input.preferences, limits },
      );
      merged.suggestions.push(...out.suggestions);
      merged.notes.push(...out.notes);
    }
    return normalizeSuggestions(merged, refs.filter((r) => scope.some((d) => d.id === r.id)), limits.maxSuggestionsPerDay);
  }

  /**
   * Uma chamada lógica com novas tentativas limitadas para erros transitórios.
   * Cada tentativa reserva orçamento antes e reconcilia o custo depois.
   */
  private async call<T>({ job, callIndex }: CallContext, task: AiTask): Promise<T> {
    const model = this.config.get('AI_MODEL');
    const entry = this.cost.entryFor(model);
    const effort = entry?.supportsEffort ? this.config.get('AI_EFFORT') : undefined;
    const maxOutputTokens = this.config.get('AI_MAX_OUTPUT_TOKENS');
    const promptChars = SYSTEM_PROMPT.length + buildUserPrompt(task).length;
    const maxRetries = this.config.get('AI_MAX_RETRIES');
    // Após retomada por queda do worker, a numeração continua de onde parou.
    const prior = await this.prisma.aiAttempt.count({ where: { jobId: job.id, callIndex } });

    for (let attemptNumber = 1; ; attemptNumber++) {
      await this.renewLease(job.id);
      let attempt;
      try {
        attempt = await this.cost.reserveAttempt({
          jobId: job.id,
          tripId: job.tripId,
          callIndex,
          attemptNumber: prior + attemptNumber,
          provider: this.provider.name,
          model,
          reservedCostMicros: this.cost.estimateReservation(promptChars, model, this.provider.name),
        });
      } catch (err) {
        if (err instanceof AiBudgetExhaustedError) throw new JobFailure('AI_BUDGET_EXHAUSTED');
        throw err;
      }

      const started = Date.now();
      let res: AttemptResult<unknown>;
      try {
        res = await this.provider.attempt(task, { model, maxOutputTokens, effort });
      } catch (err) {
        const e =
          err instanceof AiProviderError ? err : new AiProviderError('AI_PROVIDER_ERROR', 'Falha inesperada na chamada.', false);
        await this.cost.settleAttempt(attempt, {
          status: e.transient ? AiAttemptStatus.TRANSIENT_ERROR : AiAttemptStatus.ERROR,
          model: null,
          usage: null, // sem dados de uso: custo UNKNOWN (nunca zero)
          durationMs: Date.now() - started,
          errorCode: e.options.httpStatus ? `${e.code}:${e.options.httpStatus}` : e.code,
          providerRequestId: e.options.requestId ?? null,
        });
        const wait = this.retryDelay(e, attemptNumber);
        if (!e.transient || attemptNumber > maxRetries || wait === null) throw new JobFailure(e.code);
        this.logger.warn(withFields('Erro transitório; nova tentativa', { jobId: job.id, callIndex, attemptNumber, code: e.code, waitMs: wait }));
        await this.sleep(wait);
        continue;
      }

      const statusMap = {
        success: AiAttemptStatus.SUCCEEDED,
        refused: AiAttemptStatus.REFUSED,
        truncated: AiAttemptStatus.TRUNCATED,
        invalid_output: AiAttemptStatus.INVALID_OUTPUT,
      } as const;
      const settled = await this.cost.settleAttempt(attempt, {
        status: statusMap[res.status],
        model: res.model,
        usage: res.usage,
        durationMs: Date.now() - started,
        refusalCategory: res.status === 'refused' ? res.refusalCategory : null,
        providerRequestId: res.requestId,
      });
      this.logger.log(withFields('Chamada de IA concluída', { jobId: job.id,
          callIndex,
          attemptNumber,
          status: res.status,
          model: res.model,
          inputTokens: res.usage.inputTokens,
          outputTokens: res.usage.outputTokens,
          costMicros: settled.costMicros,
          costStatus: settled.costStatus, }));

      switch (res.status) {
        case 'success':
          return res.data as T;
        case 'refused':
          throw new JobFailure('AI_REQUEST_REFUSED'); // sem nova tentativa, sem troca de modelo
        case 'truncated':
          throw new JobFailure('AI_OUTPUT_TRUNCATED');
        case 'invalid_output':
          throw new JobFailure('AI_INVALID_OUTPUT');
      }
    }
  }

  /**
   * Espera antes da próxima tentativa: `retry-after` quando informado, senão
   * backoff exponencial com jitter. `null` = espera maior que o aceitável.
   */
  retryDelay(err: AiProviderError, attemptNumber: number): number | null {
    const max = this.config.get('AI_MAX_RETRY_WAIT_MS');
    const retryAfter = err.options.retryAfterMs;
    if (retryAfter !== undefined && retryAfter !== null) return retryAfter <= max ? retryAfter : null;
    const base = this.config.get('AI_RETRY_BASE_DELAY_MS') * 2 ** (attemptNumber - 1);
    return Math.min(base + Math.floor(Math.random() * base * 0.25), max);
  }

  private async renewLease(jobId: string) {
    await this.prisma.aiJob.updateMany({
      where: { id: jobId, status: AiJobStatus.RUNNING },
      data: { lockedUntil: new Date(Date.now() + this.leaseMs) },
    });
  }
}
