import { Injectable } from '@nestjs/common';
import { AiAttempt, AiAttemptStatus, AiCostStatus } from '@prisma/client';
import { buildCatalog, ModelCatalog, ModelEntry, toMicros } from '../../config/ai-catalog';
import { AppConfig } from '../../config/app-config.service';
import { MIN_RESERVATION_INPUT_TOKENS, pricingReferenceDate } from '../../config/env';
import { PrismaService, Tx } from '../../prisma/prisma.service';

export interface TokenUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheCreationInputTokens: number | null;
  cacheReadInputTokens: number | null;
}

export type CostEstimate = { status: 'ESTIMATED'; costMicros: number } | { status: 'UNKNOWN' };

/** Orçamento interno de IA da viagem esgotado. */
export class AiBudgetExhaustedError extends Error {
  constructor() {
    super('Orçamento de IA da viagem esgotado');
    this.name = 'AiBudgetExhaustedError';
  }
}

/**
 * Tokens de entrada estimados a partir do tamanho do prompt. Conservador: o
 * tokenizador atual gera ~30% mais tokens; português rende menos caracteres por
 * token que inglês. Inclui folga para o prompt de sistema da saída estruturada.
 */
const CHARS_PER_TOKEN_CONSERVATIVE = 2;
const STRUCTURED_OUTPUT_OVERHEAD_TOKENS = 1_500;

/**
 * Estimativa de custo e orçamento interno de IA por viagem.
 *
 * - Cada chamada ao provedor gera um AiAttempt com uma reserva conservadora
 *   (pior caso: entrada estimada + máximo de tokens de saída).
 * - Após a resposta, a reserva é reconciliada com o uso real (ESTIMATED). Sem
 *   dados de uso, o custo fica UNKNOWN — nunca zero — e a reserva continua
 *   contando no orçamento.
 * - Gasto da viagem = Σ custo estimado + Σ reservas (em andamento ou desconhecidas).
 * - O orçamento é interno: o usuário só vê se a IA está disponível, nunca valores.
 */
@Injectable()
export class AiCostService {
  readonly catalog: ModelCatalog;
  readonly currency: string;
  readonly referenceDate: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {
    this.catalog = buildCatalog(config.get('AI_PRICING_JSON'));
    this.currency = config.get('AI_PRICING_CURRENCY');
    this.referenceDate = pricingReferenceDate({ AI_PRICING_REFERENCE_DATE: config.get('AI_PRICING_REFERENCE_DATE') });
  }

  get budgetMicros(): number {
    return toMicros(this.config.get('AI_TRIP_BUDGET'));
  }

  get isFreeProvider(): boolean {
    return this.config.get('AI_PROVIDER') === 'mock';
  }

  entryFor(model: string): ModelEntry | undefined {
    return Object.prototype.hasOwnProperty.call(this.catalog, model) ? this.catalog[model] : undefined;
  }

  /** Reserva para uma chamada: entrada estimada + saída máxima, sem descontos de cache. */
  estimateReservation(promptChars: number, model: string, provider: string): number {
    if (provider === 'mock') return 0; // provedor simulado: sem cobrança
    const entry = this.entryFor(model);
    if (!entry) throw new Error(`Modelo sem preço configurado: ${model}`);
    const inputTokens = Math.ceil(promptChars / CHARS_PER_TOKEN_CONSERVATIVE) + STRUCTURED_OUTPUT_OVERHEAD_TOKENS;
    return Math.ceil(inputTokens * entry.inputPerMTok + this.config.get('AI_MAX_OUTPUT_TOKENS') * entry.outputPerMTok);
  }

  /** Menor reserva possível para um pedido típico; abaixo disso a IA aparece como esgotada. */
  minimumReservation(): number {
    if (this.isFreeProvider) return 0;
    const entry = this.entryFor(this.config.get('AI_MODEL'));
    if (!entry) return 0;
    return Math.ceil(
      MIN_RESERVATION_INPUT_TOKENS * entry.inputPerMTok + this.config.get('AI_MAX_OUTPUT_TOKENS') * entry.outputPerMTok,
    );
  }

  /**
   * Custo a partir do uso informado e do modelo efetivamente usado.
   * Preço por milhão de tokens × tokens = micro-unidades da moeda.
   */
  costFromUsage(model: string | null, usage: TokenUsage, provider: string): CostEstimate {
    if (provider === 'mock') return { status: 'ESTIMATED', costMicros: 0 }; // provedor simulado: sem cobrança
    const entry = model ? this.entryFor(model) : undefined;
    if (!entry || usage.inputTokens === null || usage.outputTokens === null) return { status: 'UNKNOWN' };
    const micros =
      usage.inputTokens * entry.inputPerMTok +
      usage.outputTokens * entry.outputPerMTok +
      (usage.cacheCreationInputTokens ?? 0) * entry.cacheWritePerMTok +
      (usage.cacheReadInputTokens ?? 0) * entry.cacheReadPerMTok;
    return { status: 'ESTIMATED', costMicros: Math.ceil(micros) };
  }

  /** Gasto que conta no orçamento da viagem (ver regra na documentação da classe). */
  async spentMicros(tripId: string, db: Tx | PrismaService = this.prisma): Promise<number> {
    const rows = await db.$queryRaw<{ spent: bigint | null }[]>`
      SELECT SUM(CASE WHEN "costStatus" = 'ESTIMATED' THEN "costMicros" ELSE "reservedCostMicros" END) AS spent
      FROM "AiAttempt" WHERE "tripId" = ${tripId}::uuid`;
    return Number(rows[0]?.spent ?? 0);
  }

  async isBudgetExhausted(tripId: string, db: Tx | PrismaService = this.prisma): Promise<boolean> {
    return this.budgetMicros - (await this.spentMicros(tripId, db)) < this.minimumReservation();
  }

  /** Para a reserva de cota do trabalho: confere se ainda cabe ao menos uma chamada. */
  async assertBudgetAvailable(tx: Tx, tripId: string): Promise<void> {
    if (await this.isBudgetExhausted(tripId, tx)) throw new AiBudgetExhaustedError();
  }

  /**
   * Reserva o orçamento de uma chamada antes de executá-la. A viagem fica
   * bloqueada (FOR UPDATE) durante a conferência e a gravação, então reservas
   * concorrentes nunca ultrapassam o orçamento.
   */
  async reserveAttempt(params: {
    jobId: string;
    tripId: string;
    callIndex: number;
    attemptNumber: number;
    provider: string;
    model: string;
    reservedCostMicros: number;
  }): Promise<AiAttempt> {
    return this.prisma.$transaction(async (tx) => {
      await this.prisma.lockRows(tx, 'Trip', [params.tripId]);
      const spent = await this.spentMicros(params.tripId, tx);
      if (spent + params.reservedCostMicros > this.budgetMicros) throw new AiBudgetExhaustedError();
      return tx.aiAttempt.create({
        data: {
          jobId: params.jobId,
          tripId: params.tripId,
          callIndex: params.callIndex,
          attemptNumber: params.attemptNumber,
          provider: params.provider,
          requestedModel: params.model,
          reservedCostMicros: params.reservedCostMicros,
          currency: this.currency,
          pricingReferenceDate: this.referenceDate,
        },
      });
    });
  }

  /** Reconcilia a reserva com o resultado da chamada. O registro nunca é apagado. */
  async settleAttempt(
    attempt: AiAttempt,
    outcome: {
      status: AiAttemptStatus;
      model: string | null;
      usage: TokenUsage | null;
      durationMs: number;
      errorCode?: string | null;
      refusalCategory?: string | null;
      providerRequestId?: string | null;
    },
  ): Promise<{ costStatus: AiCostStatus; costMicros: number | null }> {
    const cost = outcome.usage
      ? this.costFromUsage(outcome.model, outcome.usage, attempt.provider)
      : ({ status: 'UNKNOWN' } as const);
    await this.prisma.aiAttempt.update({
      where: { id: attempt.id },
      data: {
        status: outcome.status,
        model: outcome.model,
        inputTokens: outcome.usage?.inputTokens ?? null,
        outputTokens: outcome.usage?.outputTokens ?? null,
        cacheCreationInputTokens: outcome.usage?.cacheCreationInputTokens ?? null,
        cacheReadInputTokens: outcome.usage?.cacheReadInputTokens ?? null,
        durationMs: outcome.durationMs,
        costStatus: cost.status,
        costMicros: cost.status === 'ESTIMATED' ? cost.costMicros : null,
        errorCode: outcome.errorCode ?? null,
        refusalCategory: outcome.refusalCategory ?? null,
        providerRequestId: outcome.providerRequestId ?? null,
        finishedAt: new Date(),
      },
    });
    return { costStatus: cost.status, costMicros: cost.status === 'ESTIMATED' ? cost.costMicros : null };
  }
}
