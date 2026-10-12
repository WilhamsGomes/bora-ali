import { AiProviderError, AiTask, AiTaskOutput, AttemptOptions, AttemptResult } from '../src/modules/ai/ai-provider';
import type { TokenUsage } from '../src/modules/entitlements/ai-cost.service';
import type { ResendLikeClient } from '../src/modules/mail/resend.mail-sender';
import { MockAiProvider } from '../src/modules/ai/mock.provider';
import {
  GeocodingProvider,
  GeocodingProviderError,
  type GeocodingQuery,
  type PlaceSuggestion,
} from '../src/modules/locations/geocoding-provider';

/** Roteiro de comportamento de cada chamada ao provedor de IA falso. */
export type FakeAiStep =
  | { kind: 'success'; model?: string; usage?: Partial<TokenUsage> }
  | { kind: 'refuse'; category?: string | null; usage?: Partial<TokenUsage> }
  | { kind: 'truncated'; usage?: Partial<TokenUsage> }
  | { kind: 'invalid'; usage?: Partial<TokenUsage> }
  | { kind: 'error'; error: AiProviderError };

export const FAKE_USAGE: TokenUsage = {
  inputTokens: 1000,
  outputTokens: 500,
  cacheCreationInputTokens: null,
  cacheReadInputTokens: null,
};

/**
 * Provedor de IA controlável: cada chamada consome um passo de `script`
 * (padrão: sucesso com saída do mock). Registra as opções recebidas.
 */
export class FakeAiProvider extends MockAiProvider {
  override readonly name: string = 'fake';
  script: FakeAiStep[] = [];
  calls: AttemptOptions[] = [];

  reset() {
    this.script = [];
    this.calls = [];
  }

  override async attempt<T extends AiTask>(task: T, options: AttemptOptions): Promise<AttemptResult<AiTaskOutput<T>>> {
    this.calls.push(options);
    const step = this.script.shift() ?? { kind: 'success' };
    if (step.kind === 'error') throw step.error;
    const usage = { ...FAKE_USAGE, ...step.usage };
    const base = { model: options.model, usage, requestId: `req_fake_${this.calls.length}` };
    switch (step.kind) {
      case 'refuse':
        return { ...base, status: 'refused', refusalCategory: step.category ?? null };
      case 'truncated':
        return { ...base, status: 'truncated' };
      case 'invalid':
        return { ...base, status: 'invalid_output' };
      default: {
        const res = await super.attempt(task, options);
        if (res.status !== 'success') return res;
        return { ...base, model: step.model ?? options.model, status: 'success', data: res.data };
      }
    }
  }
}

type ResendSendArgs = Parameters<ResendLikeClient['emails']['send']>;
type ResendSendResult = Awaited<ReturnType<ResendLikeClient['emails']['send']>>;

/** Respostas roteirizadas do Resend falso (padrão: aceite). */
export type FakeResendStep =
  | { kind: 'ok' }
  | { kind: 'error'; name: string; statusCode: number; retryAfter?: string }
  | { kind: 'throw' };

/** Cliente Resend falso: deduplica por chave de idempotência como o serviço real (janela de 24 h). */
export class FakeResendClient implements ResendLikeClient {
  calls: { payload: ResendSendArgs[0]; options: ResendSendArgs[1] }[] = [];
  script: FakeResendStep[] = [];
  delayMs = 0;
  private accepted = new Map<string, string>();
  private seq = 0;

  reset() {
    this.calls = [];
    this.script = [];
    this.accepted.clear();
    this.delayMs = 0;
  }

  /** E-mails efetivamente aceitos (um por chave). */
  get acceptedCount() {
    return this.accepted.size;
  }

  emails = {
    send: (async (payload: ResendSendArgs[0], options?: ResendSendArgs[1]): Promise<ResendSendResult> => {
      this.calls.push({ payload, options });
      if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
      const key = options?.idempotencyKey ?? `no-key-${++this.seq}`;
      const previous = this.accepted.get(key);
      if (previous) return { data: { id: previous }, error: null, headers: {} };
      const step = this.script.shift() ?? { kind: 'ok' };
      if (step.kind === 'throw') throw new Error('network down');
      if (step.kind === 'error') {
        return {
          data: null,
          error: { name: step.name, message: 'erro simulado', statusCode: step.statusCode },
          headers: step.retryAfter ? { 'retry-after': step.retryAfter } : {},
        } as ResendSendResult;
      }
      const id = `email_${++this.seq}`;
      this.accepted.set(key, id);
      return { data: { id }, error: null, headers: {} };
    }) as ResendLikeClient['emails']['send'],
  };
}

/** Lugar de exemplo com dados reais do Marco Zero (Recife), no formato normalizado. */
export function place(overrides: Partial<PlaceSuggestion> = {}): PlaceSuggestion {
  return {
    provider: 'geoapify',
    placeId: 'geo-marco-zero-recife',
    name: 'Marco Zero',
    formattedAddress: 'Marco Zero, Praça Rio Branco, Recife - PE, Brasil',
    secondary: 'Praça Rio Branco, Recife - PE, Brasil',
    city: 'Recife',
    state: 'Pernambuco',
    country: 'Brasil',
    countryCode: 'BR',
    latitude: -8.0631,
    longitude: -34.8711,
    resultType: 'amenity',
    ...overrides,
  };
}

/** Provedor de geocodificação controlável: registra as consultas e devolve o roteiro configurado. */
export class FakeGeocodingProvider extends GeocodingProvider {
  readonly name = 'fake';
  readonly attribution = '© OpenStreetMap contributors · Powered by Geoapify';
  isConfigured = true;
  calls: GeocodingQuery[] = [];
  results: PlaceSuggestion[] = [place()];
  error: GeocodingProviderError | null = null;

  reset() {
    this.isConfigured = true;
    this.calls = [];
    this.results = [place()];
    this.error = null;
  }

  async search(query: GeocodingQuery): Promise<PlaceSuggestion[]> {
    this.calls.push(query);
    if (this.error) throw this.error;
    return this.results;
  }
}
