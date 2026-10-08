import { Injectable } from "@nestjs/common";
import { AiJobKind, AiJobStatus } from "@prisma/client";
import { AppError, ErrorCode } from "../../common/errors/app-error";
import { AppConfig } from "../../config/app-config.service";
import { PrismaService, Tx } from "../../prisma/prisma.service";
import { AiBudgetExhaustedError, AiCostService } from "./ai-cost.service";

export interface AiKindUsage {
  limit: number;
  /** Gerações concluídas com sucesso (consumidas). */
  used: number;
  /** Gerações em andamento (reservadas). */
  reserved: number;
  remaining: number;
}

export type AiUsage = Record<AiJobKind, AiKindUsage>;

export interface AiAvailability {
  available: boolean;
  /**
   * PROVIDER_NOT_CONFIGURED: IA indisponível no ambiente.
   * AI_BUDGET_EXHAUSTED: o uso de IA desta viagem chegou ao limite interno (sem expor valores).
   */
  reason?: "PROVIDER_NOT_CONFIGURED" | "AI_BUDGET_EXHAUSTED";
}

export const BUDGET_EXHAUSTED_MESSAGE =
  "O uso de IA desta viagem chegou ao limite. Você continua podendo editar o roteiro manualmente.";

/**
 * Cota de IA por viagem, derivada dos registros de AiJob:
 * SUCCEEDED = consumido, QUEUED/RUNNING = reservado, FAILED = liberado.
 */
@Injectable()
export class AiQuotaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly cost: AiCostService,
  ) {}

  /** Limites por viagem. Valores iniciais são configuração provisória (ver .env.example). */
  limits(): Record<AiJobKind, number> {
    return {
      DAY_SUGGESTIONS: this.config.get("AI_LIMIT_DAY_SUGGESTIONS"),
      TRIP_SUGGESTIONS: this.config.get("AI_LIMIT_TRIP_SUGGESTIONS"),
      ADJUST_ITINERARY: this.config.get("AI_LIMIT_ADJUST_ITINERARY"),
    };
  }

  availability(): AiAvailability {
    const provider = this.config.get("AI_PROVIDER");
    if (provider === "mock") return { available: !this.config.isProduction };
    return this.config.get("ANTHROPIC_API_KEY")
      ? { available: true }
      : { available: false, reason: "PROVIDER_NOT_CONFIGURED" };
  }

  /** Disponibilidade para uma viagem: provedor configurado e orçamento interno restante. */
  async availabilityFor(tripId: string): Promise<AiAvailability> {
    const provider = this.availability();
    if (!provider.available) return provider;
    return (await this.cost.isBudgetExhausted(tripId))
      ? { available: false, reason: "AI_BUDGET_EXHAUSTED" }
      : { available: true };
  }

  async usage(tripId: string, tx?: Tx): Promise<AiUsage> {
    const db = tx ?? this.prisma;
    const groups = await db.aiJob.groupBy({
      by: ["kind", "status"],
      where: {
        tripId,
        status: {
          in: [AiJobStatus.QUEUED, AiJobStatus.RUNNING, AiJobStatus.SUCCEEDED],
        },
      },
      _count: { _all: true },
    });
    const limits = this.limits();
    const result = {} as AiUsage;
    for (const kind of Object.values(AiJobKind)) {
      const count = (s: AiJobStatus) =>
        groups.find((g) => g.kind === kind && g.status === s)?._count._all ?? 0;
      const used = count(AiJobStatus.SUCCEEDED);
      const reserved = count(AiJobStatus.QUEUED) + count(AiJobStatus.RUNNING);
      result[kind] = {
        limit: limits[kind],
        used,
        reserved,
        remaining: Math.max(limits[kind] - used - reserved, 0),
      };
    }
    return result;
  }

  /**
   * Verifica a cota dentro de uma transação que já bloqueou a linha da viagem
   * (FOR UPDATE). O chamador insere o AiJob QUEUED na mesma transação — essa
   * inserção é a reserva.
   */
  async assertCanReserve(
    tx: Tx,
    tripId: string,
    kind: AiJobKind,
  ): Promise<void> {
    // Um trabalho ativo por viagem: protege contra cliques duplos e corridas entre colaboradores.
    const active = await tx.aiJob.findFirst({
      where: {
        tripId,
        status: { in: [AiJobStatus.QUEUED, AiJobStatus.RUNNING] },
      },
      select: { id: true, kind: true },
    });
    if (active) {
      throw AppError.conflict(
        ErrorCode.AI_JOB_IN_PROGRESS,
        "Já existe uma geração em andamento para esta viagem.",
        {
          jobId: active.id,
          kind: active.kind,
        },
      );
    }
    const usage = (await this.usage(tripId, tx))[kind];
    if (usage.remaining <= 0) {
      throw AppError.forbidden(
        ErrorCode.AI_USAGE_LIMIT_REACHED,
        "O limite de gerações com IA desta viagem foi atingido.",
        {
          kind,
          ...usage,
        },
      );
    }
    try {
      await this.cost.assertBudgetAvailable(tx, tripId);
    } catch (err) {
      if (err instanceof AiBudgetExhaustedError) {
        throw AppError.forbidden(
          ErrorCode.AI_BUDGET_EXHAUSTED,
          BUDGET_EXHAUSTED_MESSAGE,
        );
      }
      throw err;
    }
  }
}
