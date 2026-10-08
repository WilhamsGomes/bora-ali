import { z } from 'zod';

/**
 * Catálogo de modelos de IA: preços e capacidades usados para estimar custo e
 * montar a requisição. Valores padrão conferidos na documentação oficial da
 * Anthropic (platform.claude.com/docs/en/about-claude/pricing e
 * /models/overview) em 2026-10-07. Preços em USD por milhão de tokens.
 *
 * Pode ser estendido/sobrescrito por AI_PRICING_JSON (exige
 * AI_PRICING_REFERENCE_DATE). Preços mudam: revise ao trocar de modelo.
 */
export const modelEntrySchema = z
  .object({
    inputPerMTok: z.number().nonnegative(),
    outputPerMTok: z.number().nonnegative(),
    /** Escrita no cache de 5 minutos. */
    cacheWritePerMTok: z.number().nonnegative(),
    /** Leitura do cache. */
    cacheReadPerMTok: z.number().nonnegative(),
    /** Aceita `output_config.effort`. */
    supportsEffort: z.boolean(),
    /** Máximo de tokens de saída aceito pelo modelo (API síncrona). */
    maxOutputTokens: z.number().int().positive(),
  })
  .strict();

export type ModelEntry = z.infer<typeof modelEntrySchema>;
export const catalogSchema = z.record(z.string().regex(/^[a-z0-9][a-z0-9.@-]*$/), modelEntrySchema);
export type ModelCatalog = z.infer<typeof catalogSchema>;

export const DEFAULT_PRICING_REFERENCE_DATE = '2026-10-07';
export const DEFAULT_PRICING_CURRENCY = 'USD';

const haiku: ModelEntry = {
  inputPerMTok: 1,
  outputPerMTok: 5,
  cacheWritePerMTok: 1.25,
  cacheReadPerMTok: 0.1,
  supportsEffort: false,
  maxOutputTokens: 64_000,
};

export const DEFAULT_MODEL_CATALOG: ModelCatalog = {
  'claude-opus-5-5': {
    inputPerMTok: 4,
    outputPerMTok: 20,
    cacheWritePerMTok: 5,
    cacheReadPerMTok: 0.2,
    supportsEffort: true,
    maxOutputTokens: 128_000,
  },
  'claude-sonnet-5-5': {
    inputPerMTok: 2,
    outputPerMTok: 10,
    cacheWritePerMTok: 2.5,
    cacheReadPerMTok: 0.2,
    supportsEffort: true,
    maxOutputTokens: 128_000,
  },
  // O alias e o snapshot datado do Haiku 4.5: a resposta da API pode informar qualquer um deles.
  'claude-haiku-4-5': haiku,
  'claude-haiku-4-5-20251001': haiku,
};

/** Combina o catálogo padrão com o JSON de configuração (que tem precedência). */
export function buildCatalog(json: string | undefined): ModelCatalog {
  if (!json) return DEFAULT_MODEL_CATALOG;
  const parsed = catalogSchema.parse(JSON.parse(json));
  return { ...DEFAULT_MODEL_CATALOG, ...parsed };
}

/** Converte "1.50" (unidades da moeda) em micro-unidades inteiras. */
export function toMicros(amount: string): number {
  const [int, frac = ''] = amount.split('.');
  return Number(int) * 1_000_000 + Number((frac + '000000').slice(0, 6));
}

export function formatMicros(micros: number, currency: string): string {
  return `${(micros / 1_000_000).toFixed(4)} ${currency}`;
}
