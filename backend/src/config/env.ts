import { z } from 'zod';
import { buildCatalog, DEFAULT_PRICING_CURRENCY, DEFAULT_PRICING_REFERENCE_DATE, toMicros } from './ai-catalog';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v.trim() : undefined));

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3333),
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:3000')
      .transform((v) =>
        v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    FRONTEND_URL: z.url().default('http://localhost:3000'),
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),
    // Níveis do logger do Nest. Aceita também os nomes antigos (info → log, trace → verbose).
    LOG_LEVEL: z.preprocess(
      (v) => (v === 'info' ? 'log' : v === 'trace' ? 'verbose' : v),
      z.enum(['verbose', 'debug', 'log', 'warn', 'error', 'fatal', 'silent']).default('log'),
    ),
    /** pretty = padrão do Nest (texto colorido); json = uma linha JSON por evento. */
    LOG_FORMAT: z.enum(['pretty', 'json']).default('pretty'),
    RUN_WORKERS: bool.default(true),

    DATABASE_URL: z.string().min(1),

    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET precisa de pelo menos 32 caracteres'),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    COOKIE_SECURE: bool.default(false),
    COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
    COOKIE_DOMAIN: optionalString,

    EMAIL_PROVIDER: z.enum(['dev', 'resend', 'none']).default('none'),
    EMAIL_FROM: optionalString,
    RESEND_API_KEY: optionalString,
    /** Intervalo mínimo entre envios do mesmo convite. */
    INVITATION_RESEND_MIN_INTERVAL_SECONDS: z.coerce.number().int().min(0).max(86_400).default(60),
    /** Máximo de envios (inicial + reenvios) por convite. */
    INVITATION_MAX_SENDS: z.coerce.number().int().min(1).max(20).default(5),

    STRIPE_SECRET_KEY: optionalString,
    STRIPE_WEBHOOK_SECRET: optionalString,
    STRIPE_PRICE_PRO: optionalString,
    STRIPE_PRICE_PRO_AI: optionalString,
    STRIPE_PRICE_UPGRADE_PRO_AI: optionalString,
    STRIPE_ALLOW_LIVE_KEYS: bool.default(false),
    CHECKOUT_SESSION_TTL_MINUTES: z.coerce.number().int().min(30).max(1440).default(60),

    AI_PROVIDER: z.enum(['anthropic', 'mock']).default('anthropic'),
    ANTHROPIC_API_KEY: optionalString,
    AI_MODEL: z.string().regex(/^claude-[a-z0-9.-]+$/, 'ID de modelo Claude inválido').default('claude-opus-5-5'),
    AI_EFFORT: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('medium'),
    AI_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(600_000).default(120_000),
    /** Novas tentativas apenas para erros transitórios (429 com retry-after, 5xx, 529, rede). */
    AI_MAX_RETRIES: z.coerce.number().int().min(0).max(3).default(2),
    AI_RETRY_BASE_DELAY_MS: z.coerce.number().int().min(0).max(30_000).default(1_000),
    /** Espera máxima aceita (inclui retry-after); acima disso a tentativa falha. */
    AI_MAX_RETRY_WAIT_MS: z.coerce.number().int().min(0).max(120_000).default(30_000),

    // Cotas funcionais por viagem (gerações concluídas com sucesso).
    AI_LIMIT_DAY_SUGGESTIONS: z.coerce.number().int().min(0).max(1000).default(10),
    AI_LIMIT_TRIP_SUGGESTIONS: z.coerce.number().int().min(0).max(100).default(1),
    AI_LIMIT_ADJUST_ITINERARY: z.coerce.number().int().min(0).max(1000).default(5),

    // Limites de tamanho por pedido/resposta.
    AI_MAX_PROMPT_CHARS: z.coerce.number().int().min(50).max(2_000).default(500),
    AI_MAX_DAYS_PER_GENERATION: z.coerce.number().int().min(1).max(60).default(7),
    AI_DAYS_PER_CALL: z.coerce.number().int().min(1).max(10).default(3),
    AI_MAX_CONTEXT_ACTIVITIES_PER_DAY: z.coerce.number().int().min(1).max(100).default(25),
    AI_MAX_SUGGESTIONS_PER_DAY: z.coerce.number().int().min(1).max(15).default(5),
    AI_MAX_ADJUST_CHANGES: z.coerce.number().int().min(1).max(50).default(10),
    AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(1_000).max(64_000).default(8_000),

    // Custo e orçamento interno (não exposto ao usuário).
    AI_PRICING_JSON: optionalString,
    AI_PRICING_CURRENCY: z.string().regex(/^[A-Z]{3}$/).default(DEFAULT_PRICING_CURRENCY),
    AI_PRICING_REFERENCE_DATE: optionalString,
    /** Orçamento máximo de IA por viagem, na moeda de preços (ex.: "1.50"). */
    AI_TRIP_BUDGET: z
      .string()
      .regex(/^\d{1,4}(\.\d{1,6})?$/, 'use um valor decimal, ex.: 1.50')
      .default('1.50'),

    MAX_TRIP_DAYS: z.coerce.number().int().min(1).max(365).default(60),

    // Busca de locais (autocomplete/geocodificação). A chave fica só no backend.
    /** geoapify = busca real · none = busca desativada (503 LOCATION_SEARCH_UNAVAILABLE). */
    GEOCODING_PROVIDER: z.enum(['geoapify', 'none']).default('geoapify'),
    GEOAPIFY_API_KEY: optionalString,
    GEOCODING_TIMEOUT_MS: z.coerce.number().int().min(500).max(15_000).default(4_000),
    /** Cache em memória (1ª camada, por processo) de buscas idênticas. 0 desativa. */
    GEOCODING_CACHE_TTL_SECONDS: z.coerce.number().int().min(0).max(30 * 86_400).default(86_400),
    GEOCODING_CACHE_MAX_ENTRIES: z.coerce.number().int().min(0).max(100_000).default(2_000),
    /** Cache no banco (2ª camada, compartilhado e persistente). Os termos da Geoapify permitem armazenar. 0 desativa. */
    GEOCODING_DB_CACHE_TTL_DAYS: z.coerce.number().int().min(0).max(3_650).default(90),
    /** Consultas ao provedor por usuário por minuto (cache não conta). */
    GEOCODING_USER_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(600).default(40),
  })
  .superRefine((env, ctx) => {
    const prod = env.NODE_ENV === 'production';
    if (prod && env.AI_PROVIDER === 'mock') {
      ctx.addIssue({ code: 'custom', path: ['AI_PROVIDER'], message: 'mock não é permitido em produção' });
    }
    if (prod && env.EMAIL_PROVIDER === 'dev') {
      ctx.addIssue({ code: 'custom', path: ['EMAIL_PROVIDER'], message: 'dev não é permitido em produção' });
    }
    if (prod && env.COOKIE_SAMESITE === 'none' && !env.COOKIE_SECURE) {
      ctx.addIssue({ code: 'custom', path: ['COOKIE_SECURE'], message: 'SameSite=None exige COOKIE_SECURE=true' });
    }
    if (env.AI_PRICING_JSON && !env.AI_PRICING_REFERENCE_DATE) {
      ctx.addIssue({
        code: 'custom',
        path: ['AI_PRICING_REFERENCE_DATE'],
        message: 'informe a data de referência (YYYY-MM-DD) dos preços em AI_PRICING_JSON',
      });
    }
    if (env.AI_PRICING_REFERENCE_DATE && !/^\d{4}-\d{2}-\d{2}$/.test(env.AI_PRICING_REFERENCE_DATE)) {
      ctx.addIssue({ code: 'custom', path: ['AI_PRICING_REFERENCE_DATE'], message: 'use o formato YYYY-MM-DD' });
    }
    let catalog;
    try {
      catalog = buildCatalog(env.AI_PRICING_JSON);
    } catch (err) {
      ctx.addIssue({ code: 'custom', path: ['AI_PRICING_JSON'], message: `JSON de preços inválido: ${(err as Error).message}` });
    }
    if (catalog && env.AI_PROVIDER === 'anthropic') {
      const model = catalog[env.AI_MODEL];
      if (!model) {
        ctx.addIssue({
          code: 'custom',
          path: ['AI_MODEL'],
          message: `modelo sem preço configurado (conhecidos: ${Object.keys(catalog).join(', ')}). Adicione-o em AI_PRICING_JSON.`,
        });
      } else if (env.AI_MAX_OUTPUT_TOKENS > model.maxOutputTokens) {
        ctx.addIssue({ code: 'custom', path: ['AI_MAX_OUTPUT_TOKENS'], message: `acima do máximo do modelo (${model.maxOutputTokens})` });
      } else {
        // O orçamento precisa comportar ao menos a reserva de uma chamada no pior caso.
        const reservation = Math.ceil(
          MIN_RESERVATION_INPUT_TOKENS * model.inputPerMTok + env.AI_MAX_OUTPUT_TOKENS * model.outputPerMTok,
        );
        if (toMicros(env.AI_TRIP_BUDGET) < reservation) {
          ctx.addIssue({
            code: 'custom',
            path: ['AI_TRIP_BUDGET'],
            message: `orçamento menor que a reserva de uma chamada (${(reservation / 1e6).toFixed(4)} ${env.AI_PRICING_CURRENCY})`,
          });
        }
      }
    }
    if (env.STRIPE_SECRET_KEY?.startsWith('sk_live_') && !env.STRIPE_ALLOW_LIVE_KEYS) {
      ctx.addIssue({
        code: 'custom',
        path: ['STRIPE_SECRET_KEY'],
        message: 'Chaves live do Stripe são recusadas. Use sk_test_ (ou STRIPE_ALLOW_LIVE_KEYS=true conscientemente).',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

/** Tokens de entrada assumidos na reserva mínima (pedido típico com contexto). Ver AiCostService. */
export const MIN_RESERVATION_INPUT_TOKENS = 6_000;

export function pricingReferenceDate(env: Pick<Env, 'AI_PRICING_REFERENCE_DATE'>): string {
  return env.AI_PRICING_REFERENCE_DATE ?? DEFAULT_PRICING_REFERENCE_DATE;
}

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuração de ambiente inválida:\n${issues}`);
  }
  return parsed.data;
}
