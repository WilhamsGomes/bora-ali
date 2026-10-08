import { validateEnv } from './env';
import { buildCatalog, toMicros } from './ai-catalog';

const base = { DATABASE_URL: 'postgresql://x', JWT_ACCESS_SECRET: 'x'.repeat(32) };

describe('configuração de modelo e preços de IA', () => {
  it('aceita os modelos do catálogo padrão', () => {
    for (const model of ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5']) {
      expect(validateEnv({ ...base, AI_MODEL: model }).AI_MODEL).toBe(model);
    }
  });

  it('recusa modelo sem preço configurado ou com ID inválido', () => {
    expect(() => validateEnv({ ...base, AI_MODEL: 'claude-inexistente-9' })).toThrow(/AI_MODEL: modelo sem preço/);
    expect(() => validateEnv({ ...base, AI_MODEL: 'gpt-4o' })).toThrow(/AI_MODEL/);
  });

  it('com o provedor simulado, o modelo não precisa de preço', () => {
    expect(() => validateEnv({ ...base, AI_PROVIDER: 'mock', AI_MODEL: 'claude-inexistente-9' })).not.toThrow();
  });

  it('AI_PRICING_JSON adiciona modelos e exige data de referência', () => {
    const json = JSON.stringify({
      'claude-novo-1': {
        inputPerMTok: 3,
        outputPerMTok: 15,
        cacheWritePerMTok: 3.75,
        cacheReadPerMTok: 0.3,
        supportsEffort: true,
        maxOutputTokens: 64000,
      },
    });
    expect(() => validateEnv({ ...base, AI_MODEL: 'claude-novo-1', AI_PRICING_JSON: json })).toThrow(/AI_PRICING_REFERENCE_DATE/);
    const env = validateEnv({ ...base, AI_MODEL: 'claude-novo-1', AI_PRICING_JSON: json, AI_PRICING_REFERENCE_DATE: '2026-10-07' });
    expect(buildCatalog(env.AI_PRICING_JSON)['claude-novo-1'].outputPerMTok).toBe(15);
    expect(buildCatalog(env.AI_PRICING_JSON)['claude-opus-5-5']).toBeDefined(); // padrão preservado
  });

  it('recusa JSON de preços malformado ou incompleto', () => {
    const ref = { AI_PRICING_REFERENCE_DATE: '2026-10-07' };
    expect(() => validateEnv({ ...base, ...ref, AI_PRICING_JSON: '{nao-json' })).toThrow(/AI_PRICING_JSON/);
    expect(() =>
      validateEnv({ ...base, ...ref, AI_PRICING_JSON: JSON.stringify({ 'claude-x': { inputPerMTok: 1 } }) }),
    ).toThrow(/AI_PRICING_JSON/);
    expect(() => validateEnv({ ...base, AI_PRICING_REFERENCE_DATE: '07/10/2026' })).toThrow(/AI_PRICING_REFERENCE_DATE/);
  });

  it('recusa orçamento menor que a reserva de uma chamada e saída acima do máximo do modelo', () => {
    expect(() => validateEnv({ ...base, AI_TRIP_BUDGET: '0.01' })).toThrow(/AI_TRIP_BUDGET/);
    expect(() => validateEnv({ ...base, AI_MODEL: 'claude-haiku-4-5', AI_MAX_OUTPUT_TOKENS: '64001' })).toThrow(/AI_MAX_OUTPUT_TOKENS/);
  });

  it('usa limites conservadores por padrão', () => {
    const env = validateEnv(base);
    expect(env).toMatchObject({
      AI_MODEL: 'claude-opus-5-5',
      AI_LIMIT_DAY_SUGGESTIONS: 10,
      AI_LIMIT_TRIP_SUGGESTIONS: 1,
      AI_LIMIT_ADJUST_ITINERARY: 5,
      AI_MAX_OUTPUT_TOKENS: 8000,
      AI_MAX_DAYS_PER_GENERATION: 7,
      AI_TRIP_BUDGET: '1.50',
      AI_PRICING_CURRENCY: 'USD',
    });
    expect(toMicros('1.50')).toBe(1_500_000);
    expect(toMicros('0.000001')).toBe(1);
  });
});
