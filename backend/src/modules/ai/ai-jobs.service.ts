import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AiJob, AiJobKind, Prisma } from '@prisma/client';
import { AppError, ErrorCode } from '../../common/errors/app-error';
import { AppConfig } from '../../config/app-config.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AiQuotaService } from '../entitlements/ai-quota.service';
import type { AiEntitlementDto } from '../entitlements/dto/entitlements.dto';
import { PLAN_FEATURES } from '../entitlements/plan-policy';
import { roleCan, TripAccessService } from '../entitlements/trip-access.service';
import { JobInput, jobInputSchema } from './ai.schemas';
import type { AiJobDto, AiJobResultDto } from './dto/ai.dto';

export function toAiJobDto(job: AiJob): AiJobDto {
  return {
    id: job.id,
    tripId: job.tripId,
    kind: job.kind,
    status: job.status,
    input: job.input as Record<string, unknown>,
    result: (job.result as AiJobResultDto | null) ?? null,
    error: job.errorCode ? { code: job.errorCode, message: job.errorMessage ?? '' } : null,
    usage: {
      provider: job.provider,
      model: job.model,
      inputTokens: job.inputTokens,
      outputTokens: job.outputTokens,
      attempts: job.attempts,
    },
    requestedById: job.requestedById,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  };
}

/** Serialização estável para comparar pedidos com a mesma chave de idempotência. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

@Injectable()
export class AiJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TripAccessService,
    private readonly quota: AiQuotaService,
    private readonly config: AppConfig,
  ) {}

  /** Informa limite, uso e se a operação está disponível antes de gerar. */
  async status(userId: string, tripId: string): Promise<AiEntitlementDto> {
    const { trip, role } = await this.access.require(userId, tripId, 'trip:read');
    const availability = await this.quota.availabilityFor(trip.id);
    const enabled = PLAN_FEATURES[trip.plan].ai;
    return {
      enabled,
      available: availability.available,
      unavailableReason: availability.reason,
      canRequest: enabled && availability.available && roleCan(role, 'ai:use'),
      usage: await this.quota.usage(tripId),
    };
  }

  /**
   * Reserva atômica: na mesma transação, bloqueia a viagem (FOR UPDATE), confere
   * cota e trabalhos ativos e grava o AiJob QUEUED — que é a reserva. O
   * processamento acontece no worker; o cliente acompanha por GET /ai/jobs/:id.
   */
  async request(
    userId: string,
    tripId: string,
    input: JobInput,
    idempotencyKey: string | undefined,
  ): Promise<{ job: AiJobDto; created: boolean }> {
    const key = idempotencyKey?.trim() || randomUUID();
    if (key.length > 100) {
      throw AppError.badRequest(ErrorCode.VALIDATION_ERROR, 'Idempotency-Key deve ter até 100 caracteres.');
    }
    const parsed = jobInputSchema.parse(input);
    const text = parsed.kind === 'ADJUST_ITINERARY' ? parsed.instruction : (parsed.preferences.prompt ?? '');
    const maxChars = this.config.get('AI_MAX_PROMPT_CHARS');
    if (text.length > maxChars) {
      throw AppError.unprocessable(ErrorCode.AI_REQUEST_TOO_LARGE, `O pedido pode ter até ${maxChars} caracteres.`, {
        maxChars,
        length: text.length,
      });
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.access.require(userId, tripId, 'ai:use', tx);
        const availability = this.quota.availability();
        if (!availability.available) {
          throw AppError.unavailable(ErrorCode.AI_UNAVAILABLE, 'A geração com IA está indisponível no momento.', {
            reason: availability.reason,
          });
        }
        await this.prisma.lockRows(tx, 'Trip', [tripId]);

        const existing = await tx.aiJob.findUnique({ where: { tripId_idempotencyKey: { tripId, idempotencyKey: key } } });
        if (existing) {
          if (existing.kind !== parsed.kind || stableJson(existing.input) !== stableJson(parsed)) {
            throw AppError.unprocessable(
              ErrorCode.IDEMPOTENCY_KEY_REUSED,
              'Esta Idempotency-Key já foi usada com outro pedido.',
            );
          }
          return { job: toAiJobDto(existing), created: false };
        }

        if (parsed.kind === 'DAY_SUGGESTIONS') {
          const day = await tx.tripDay.findFirst({ where: { id: parsed.dayId, tripId } });
          if (!day) throw AppError.notFound(ErrorCode.DAY_NOT_FOUND, 'Dia não encontrado nesta viagem.');
        }
        if (parsed.kind !== 'DAY_SUGGESTIONS') {
          // Quantidade de dias por geração (viagem inteira ou ajuste).
          let days: number;
          if (parsed.dayIds?.length) {
            days = new Set(parsed.dayIds).size;
            const count = await tx.tripDay.count({ where: { id: { in: parsed.dayIds }, tripId } });
            if (count !== days) {
              throw AppError.notFound(ErrorCode.DAY_NOT_FOUND, 'Um ou mais dias não pertencem a esta viagem.');
            }
          } else {
            days = await tx.tripDay.count({ where: { tripId } });
          }
          const maxDays = this.config.get('AI_MAX_DAYS_PER_GENERATION');
          if (days > maxDays) {
            throw AppError.unprocessable(
              ErrorCode.AI_TOO_MANY_DAYS,
              `Cada geração com IA pode abranger até ${maxDays} dias. Selecione os dias desejados.`,
              { maxDays, requestedDays: days },
            );
          }
        }

        await this.quota.assertCanReserve(tx, tripId, parsed.kind as AiJobKind);
        const job = await tx.aiJob.create({
          data: {
            tripId,
            requestedById: userId,
            kind: parsed.kind as AiJobKind,
            idempotencyKey: key,
            input: parsed as Prisma.InputJsonValue,
          },
        });
        return { job: toAiJobDto(job), created: true };
      });
    } catch (err) {
      // Corrida rara entre duas requisições com a mesma chave: devolve o trabalho já criado.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const job = await this.prisma.aiJob.findUniqueOrThrow({
          where: { tripId_idempotencyKey: { tripId, idempotencyKey: key } },
        });
        return { job: toAiJobDto(job), created: false };
      }
      throw err;
    }
  }

  async get(userId: string, tripId: string, jobId: string): Promise<AiJobDto> {
    await this.access.require(userId, tripId, 'trip:read');
    const job = await this.prisma.aiJob.findFirst({ where: { id: jobId, tripId } });
    if (!job) throw AppError.notFound(ErrorCode.AI_JOB_NOT_FOUND, 'Trabalho de IA não encontrado.');
    return toAiJobDto(job);
  }

  async list(userId: string, tripId: string): Promise<AiJobDto[]> {
    await this.access.require(userId, tripId, 'trip:read');
    const jobs = await this.prisma.aiJob.findMany({ where: { tripId }, orderBy: { createdAt: 'desc' }, take: 20 });
    return jobs.map(toAiJobDto);
  }
}
