import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { Injectable } from '@nestjs/common';
import { AppConfig } from '../../config/app-config.service';
import { AiProviderError, AiProvider, AiTask, AiTaskOutput, AttemptOptions, AttemptResult } from './ai-provider';
import { modelAdjustOutputSchema, modelSuggestionsOutputSchema } from './ai.schemas';
import { buildUserPrompt, SYSTEM_PROMPT } from './prompts';

/**
 * Claude via SDK oficial (Messages API), com saída estruturada validada pelo SDK.
 *
 * - Faz exatamente UMA chamada: `maxRetries: 0` no SDK. Novas tentativas, backoff
 *   e `retry-after` ficam no worker, que também reserva orçamento por tentativa.
 * - Sem fallback entre modelos: uma recusa (`stop_reason: "refusal"`) é devolvida
 *   como resultado explícito.
 */
@Injectable()
export class AnthropicProvider extends AiProvider {
  readonly name: string = 'anthropic';
  private readonly client: Anthropic | null;

  constructor(config: AppConfig) {
    super();
    const apiKey = config.get('ANTHROPIC_API_KEY');
    this.client = apiKey ? new Anthropic({ apiKey, timeout: config.get('AI_TIMEOUT_MS'), maxRetries: 0 }) : null;
  }

  async attempt<T extends AiTask>(task: T, options: AttemptOptions): Promise<AttemptResult<AiTaskOutput<T>>> {
    if (!this.client) throw new AiProviderError('AI_UNAVAILABLE', 'Provedor de IA não configurado.', false);
    const schema = task.type === 'suggest' ? modelSuggestionsOutputSchema : modelAdjustOutputSchema;

    let response;
    try {
      response = await this.client.messages.parse({
        model: options.model,
        max_tokens: options.maxOutputTokens,
        output_config: {
          format: zodOutputFormat(schema),
          ...(options.effort ? { effort: options.effort } : {}),
        },
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildUserPrompt(task) }],
      });
    } catch (err) {
      throw mapAnthropicError(err);
    }

    const base = {
      model: response.model,
      requestId: response._request_id ?? null,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? null,
        cacheReadInputTokens: response.usage.cache_read_input_tokens ?? null,
      },
    };
    // Sempre conferir stop_reason antes do conteúdo.
    if (response.stop_reason === 'refusal') {
      return { ...base, status: 'refused', refusalCategory: response.stop_details?.category ?? null };
    }
    if (response.stop_reason === 'max_tokens') return { ...base, status: 'truncated' };
    if (!response.parsed_output) return { ...base, status: 'invalid_output' };
    return { ...base, status: 'success', data: response.parsed_output as AiTaskOutput<T> };
  }
}

/** Interpreta `retry-after` (segundos ou data HTTP). */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

/** Classifica erros do SDK (do mais específico para o mais genérico). */
export function mapAnthropicError(err: unknown): AiProviderError {
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return new AiProviderError('AI_TIMEOUT', 'Tempo limite do provedor de IA excedido.', true);
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new AiProviderError('AI_PROVIDER_ERROR', 'Falha de conexão com o provedor de IA.', true);
  }
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new AiProviderError('AI_UNAVAILABLE', 'Credenciais do provedor de IA inválidas.', false, {
      httpStatus: err.status,
      requestId: err.requestID ?? null,
    });
  }
  if (err instanceof Anthropic.RateLimitError) {
    const retryAfterMs = parseRetryAfter(err.headers?.get('retry-after'));
    const body = err.error as { error?: { details?: { error_code?: string } } } | undefined;
    // Limite de gasto mensal: 429 sem retry-after. Repetir não adianta até o próximo ciclo.
    const spendCap = body?.error?.details?.error_code === 'enforced_spend_limit_reached' || retryAfterMs === null;
    return new AiProviderError('AI_RATE_LIMITED', 'Limite de uso do provedor de IA atingido.', !spendCap, {
      retryAfterMs,
      httpStatus: 429,
      requestId: err.requestID ?? null,
    });
  }
  if (err instanceof Anthropic.APIError) {
    const status = typeof err.status === 'number' ? err.status : null;
    // 500 api_error, 504 timeout_error, 529 overloaded_error e demais 5xx: transitórios.
    const transient = status !== null && status >= 500;
    return new AiProviderError('AI_PROVIDER_ERROR', `Erro do provedor de IA (${status ?? 'desconhecido'}).`, transient, {
      retryAfterMs: parseRetryAfter(err.headers?.get('retry-after')),
      httpStatus: status,
      requestId: err.requestID ?? null,
    });
  }
  // Erro de parsing do SDK ou inesperado: não é transitório.
  return new AiProviderError('AI_INVALID_OUTPUT', 'Falha ao interpretar a resposta da IA.', false);
}
