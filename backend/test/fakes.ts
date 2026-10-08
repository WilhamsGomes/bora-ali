import Stripe from 'stripe';
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

export const WEBHOOK_SECRET = 'whsec_test_secret';
const PRICES: Record<string, number> = { price_pro: 990, price_pro_ai: 1990, price_upgrade: 1000 };
const realStripe = new Stripe('sk_test_fake');

type Session = Stripe.Checkout.Session;

/**
 * Substituto do StripeGateway: guarda sessões/cobranças em memória, mas verifica
 * assinaturas de webhook com o código real do SDK.
 */
export class FakeStripeGateway {
  readonly isConfigured = true;
  sessions = new Map<string, Session>();
  charges = new Map<string, Stripe.Charge>();
  disputes = new Map<string, Stripe.Dispute>();
  createCalls: { params: Stripe.Checkout.SessionCreateParams; idempotencyKey: string }[] = [];
  private byIdempotencyKey = new Map<string, Session>();
  private seq = 0;

  constructEvent(rawBody: Buffer, signature: string): Stripe.Event {
    return realStripe.webhooks.constructEvent(rawBody, signature, WEBHOOK_SECRET);
  }

  async createCustomer(): Promise<Stripe.Customer> {
    return { id: `cus_test_${++this.seq}` } as Stripe.Customer;
  }

  async retrievePrice(priceId: string): Promise<Stripe.Price> {
    return { id: priceId, active: true, type: 'one_time', currency: 'brl', unit_amount: PRICES[priceId] } as Stripe.Price;
  }

  async createCheckoutSession(params: Stripe.Checkout.SessionCreateParams, idempotencyKey: string): Promise<Session> {
    this.createCalls.push({ params, idempotencyKey });
    const cached = this.byIdempotencyKey.get(idempotencyKey);
    if (cached) return cached;
    const id = `cs_test_${++this.seq}`;
    const priceId = params.line_items![0].price!;
    const session = {
      id,
      object: 'checkout.session',
      url: `https://checkout.stripe.test/${id}`,
      status: 'open',
      payment_status: 'unpaid',
      mode: 'payment',
      currency: 'brl',
      amount_total: PRICES[priceId],
      client_reference_id: params.client_reference_id ?? null,
      metadata: params.metadata ?? {},
      expires_at: params.expires_at ?? Math.floor(Date.now() / 1000) + 3600,
      payment_intent: null,
    } as unknown as Session;
    this.sessions.set(id, session);
    this.byIdempotencyKey.set(idempotencyKey, session);
    return session;
  }

  async retrieveCheckoutSession(id: string): Promise<Session> {
    const s = this.sessions.get(id);
    if (!s) throw new Error(`Sessão ${id} inexistente`);
    return structuredClone(s);
  }

  async expireCheckoutSession(id: string): Promise<Session> {
    const s = this.sessions.get(id)!;
    if (s.status === 'open') Object.assign(s, { status: 'expired' });
    return s;
  }

  async retrieveCharge(id: string): Promise<Stripe.Charge> {
    return this.charges.get(id)!;
  }

  async retrieveDispute(id: string): Promise<Stripe.Dispute> {
    return this.disputes.get(id)!;
  }

  // ───── Simulações de estado no Stripe ─────

  pay(sessionId: string, opts: { async?: boolean; amountTotal?: number } = {}) {
    const s = this.sessions.get(sessionId)!;
    const piId = `pi_${sessionId}`;
    Object.assign(s, {
      status: 'complete',
      payment_status: opts.async ? 'unpaid' : 'paid',
      payment_intent: { id: piId, status: opts.async ? 'processing' : 'succeeded' },
      ...(opts.amountTotal !== undefined ? { amount_total: opts.amountTotal } : {}),
    });
    return piId;
  }

  settleAsync(sessionId: string, succeeded: boolean) {
    const s = this.sessions.get(sessionId)!;
    Object.assign(s, {
      payment_status: succeeded ? 'paid' : 'unpaid',
      payment_intent: { id: `pi_${sessionId}`, status: succeeded ? 'succeeded' : 'requires_payment_method' },
    });
  }

  refund(sessionId: string, full = true) {
    const chargeId = `ch_${sessionId}`;
    this.charges.set(chargeId, { id: chargeId, payment_intent: `pi_${sessionId}`, refunded: full } as Stripe.Charge);
    return chargeId;
  }

  dispute(sessionId: string, status: Stripe.Dispute.Status) {
    const id = `dp_${sessionId}`;
    this.disputes.set(id, { id, payment_intent: `pi_${sessionId}`, status } as Stripe.Dispute);
    return id;
  }
}

/** Monta um webhook assinado como o Stripe faria. */
export function signedEvent(type: string, object: { id: string }, eventId = `evt_${Math.random().toString(36).slice(2)}`) {
  const payload = JSON.stringify({ id: eventId, object: 'event', type, data: { object }, api_version: '2026-09-30.endive' });
  const signature = realStripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  return { payload, signature, eventId };
}

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
