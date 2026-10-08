import type { TokenUsage } from '../entitlements/ai-cost.service';
import type { ModelAdjustOutput, ModelSuggestionsOutput, Preferences } from './ai.schemas';

export interface ContextActivity {
  id: string;
  version: number;
  time: string;
  title: string;
  category: string;
  durationMinutes: number | null;
  location: string | null;
}

export interface ContextDay {
  date: string;
  title: string | null;
  activities: ContextActivity[];
  /** Atividades omitidas do contexto pelo limite AI_MAX_CONTEXT_ACTIVITIES_PER_DAY. */
  omittedActivities: number;
}

export interface TripContext {
  name: string;
  destination: string;
  timeZone: string;
  stay: string | null;
  startDate: string;
  endDate: string;
}

export interface OutputLimits {
  maxSuggestionsPerDay: number;
  maxChanges: number;
}

export type AiTask =
  | { type: 'suggest'; trip: TripContext; days: ContextDay[]; preferences: Preferences; limits: OutputLimits }
  | { type: 'adjust'; trip: TripContext; days: ContextDay[]; instruction: string; limits: OutputLimits };

export type AiTaskOutput<T extends AiTask> = T extends { type: 'suggest' } ? ModelSuggestionsOutput : ModelAdjustOutput;

export interface AttemptOptions {
  model: string;
  maxOutputTokens: number;
  /** Enviado apenas quando o modelo aceita `output_config.effort`. */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
}

interface AttemptBase {
  /** Modelo efetivamente usado, conforme a resposta do provedor. */
  model: string;
  usage: TokenUsage;
  requestId: string | null;
}

/**
 * Resultado de UMA chamada ao provedor (sem novas tentativas internas).
 * - success: saída validada pelo schema.
 * - refused: o modelo recusou (stop_reason "refusal"). Resultado explícito; nunca repetido nem desviado para outro modelo.
 * - truncated: atingiu o limite de tokens de saída.
 * - invalid_output: resposta fora do schema.
 */
export type AttemptResult<T> =
  | (AttemptBase & { status: 'success'; data: T })
  | (AttemptBase & { status: 'refused'; refusalCategory: string | null })
  | (AttemptBase & { status: 'truncated' | 'invalid_output' });

export type AiErrorCode =
  | 'AI_TIMEOUT'
  | 'AI_PROVIDER_ERROR'
  | 'AI_RATE_LIMITED'
  | 'AI_UNAVAILABLE'
  | 'AI_INVALID_OUTPUT'
  | 'AI_OUTPUT_TRUNCATED'
  | 'AI_REQUEST_REFUSED'
  | 'AI_BUDGET_EXHAUSTED'
  | 'AI_WORKER_TIMEOUT';

/**
 * Falha de transporte/API, sem resposta utilizável. `transient` indica se uma
 * nova tentativa faz sentido (rede, timeout, 429 com retry-after, 5xx, 529).
 */
export class AiProviderError extends Error {
  constructor(
    readonly code: AiErrorCode,
    message: string,
    readonly transient: boolean,
    readonly options: { retryAfterMs?: number | null; httpStatus?: number | null; requestId?: string | null } = {},
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}

/** Porta para o provedor de IA. Implementações: Anthropic (produção) e mock (dev/testes). */
export abstract class AiProvider {
  abstract readonly name: string;
  abstract attempt<T extends AiTask>(task: T, options: AttemptOptions): Promise<AttemptResult<AiTaskOutput<T>>>;
}
