import Anthropic from '@anthropic-ai/sdk';
import { AppConfig } from '../../config/app-config.service';
import { AnthropicProvider, mapAnthropicError, parseRetryAfter } from './anthropic.provider';
import type { AiTask } from './ai-provider';

function provider() {
  const saved = { ...process.env };
  process.env = { DATABASE_URL: 'postgresql://x', JWT_ACCESS_SECRET: 'x'.repeat(32), ANTHROPIC_API_KEY: 'sk-ant-unit-test' };
  try {
    return new AnthropicProvider(new AppConfig());
  } finally {
    process.env = saved;
  }
}

const task: AiTask = {
  type: 'suggest',
  trip: { name: 'T', destination: 'Lisboa', timeZone: 'Europe/Lisbon', stay: null, startDate: '2026-12-20', endDate: '2026-12-20' },
  days: [{ date: '2026-12-20', title: null, activities: [], omittedActivities: 0 }],
  preferences: { interests: [], pace: 'tranquilo', budget: 'moderado' },
  limits: { maxSuggestionsPerDay: 3, maxChanges: 5 },
};

function fakeResponse(over: Record<string, unknown>) {
  return {
    model: 'claude-opus-5-5',
    _request_id: 'req_1',
    stop_reason: 'end_turn',
    stop_details: null,
    parsed_output: { suggestions: [], notes: [] },
    usage: { input_tokens: 10, output_tokens: 20, cache_creation_input_tokens: null, cache_read_input_tokens: 5 },
    ...over,
  };
}

/** Substitui o cliente HTTP do SDK por um dublê (nenhuma chamada real). */
function withClient(p: AnthropicProvider, parse: jest.Mock) {
  Object.assign(p, { client: { messages: { parse } } });
  return parse;
}

describe('AnthropicProvider', () => {
  it('faz uma única chamada sem parâmetros de fallback entre modelos', async () => {
    const p = provider();
    const parse = withClient(p, jest.fn().mockResolvedValue(fakeResponse({})));
    const res = await p.attempt(task, { model: 'claude-opus-5-5', maxOutputTokens: 4000, effort: 'medium' });

    expect(parse).toHaveBeenCalledTimes(1);
    const params = parse.mock.calls[0][0];
    expect(params).not.toHaveProperty('fallbacks');
    expect(params).not.toHaveProperty('betas');
    expect(params).toMatchObject({ model: 'claude-opus-5-5', max_tokens: 4000, output_config: { effort: 'medium' } });
    expect(res).toMatchObject({
      status: 'success',
      model: 'claude-opus-5-5',
      requestId: 'req_1',
      usage: { inputTokens: 10, outputTokens: 20, cacheCreationInputTokens: null, cacheReadInputTokens: 5 },
    });
  });

  it('omite effort para modelos que não o aceitam', async () => {
    const p = provider();
    const parse = withClient(p, jest.fn().mockResolvedValue(fakeResponse({ model: 'claude-haiku-4-5-20251001' })));
    await p.attempt(task, { model: 'claude-haiku-4-5', maxOutputTokens: 4000 });
    expect(parse.mock.calls[0][0].output_config).not.toHaveProperty('effort');
  });

  it('devolve recusa como resultado explícito, com uso e categoria', async () => {
    const p = provider();
    withClient(
      p,
      jest.fn().mockResolvedValue(
        fakeResponse({ stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber' }, parsed_output: null }),
      ),
    );
    const res = await p.attempt(task, { model: 'claude-opus-5-5', maxOutputTokens: 4000 });
    expect(res).toMatchObject({ status: 'refused', refusalCategory: 'cyber', usage: { inputTokens: 10 } });
  });

  it('identifica saída truncada e fora do schema', async () => {
    const p = provider();
    withClient(p, jest.fn().mockResolvedValueOnce(fakeResponse({ stop_reason: 'max_tokens' })).mockResolvedValueOnce(fakeResponse({ parsed_output: null })));
    expect((await p.attempt(task, { model: 'claude-opus-5-5', maxOutputTokens: 4000 })).status).toBe('truncated');
    expect((await p.attempt(task, { model: 'claude-opus-5-5', maxOutputTokens: 4000 })).status).toBe('invalid_output');
  });
});

describe('classificação de erros da Anthropic', () => {
  const headers = (h: Record<string, string>) => new Headers(h);

  it('429 com retry-after é transitório e informa a espera', () => {
    const err = mapAnthropicError(
      new Anthropic.RateLimitError(429, { error: { type: 'rate_limit_error' } }, 'rate', headers({ 'retry-after': '7' })),
    );
    expect(err).toMatchObject({ code: 'AI_RATE_LIMITED', transient: true, options: { retryAfterMs: 7000, httpStatus: 429 } });
  });

  it('429 de limite de gasto (sem retry-after) não é repetido', () => {
    const err = mapAnthropicError(
      new Anthropic.RateLimitError(
        429,
        { error: { type: 'rate_limit_error', details: { error_code: 'enforced_spend_limit_reached' } } },
        'spend',
        headers({}),
      ),
    );
    expect(err.transient).toBe(false);
  });

  it('5xx/529 e falhas de rede são transitórios; 400/401 não', () => {
    expect(mapAnthropicError(new Anthropic.InternalServerError(529, { error: {} }, 'overloaded', headers({}))).transient).toBe(true);
    expect(mapAnthropicError(new Anthropic.InternalServerError(500, { error: {} }, 'x', headers({}))).transient).toBe(true);
    expect(mapAnthropicError(new Anthropic.APIConnectionTimeoutError()).toString()).toContain('AiProviderError');
    expect(mapAnthropicError(new Anthropic.APIConnectionTimeoutError()).transient).toBe(true);
    expect(mapAnthropicError(new Anthropic.APIConnectionError({ message: 'down' })).transient).toBe(true);
    expect(mapAnthropicError(new Anthropic.BadRequestError(400, { error: {} }, 'bad', headers({}))).transient).toBe(false);
    expect(mapAnthropicError(new Anthropic.AuthenticationError(401, { error: {} }, 'auth', headers({}))).code).toBe('AI_UNAVAILABLE');
  });

  it('interpreta retry-after em segundos ou data HTTP', () => {
    expect(parseRetryAfter('3')).toBe(3000);
    expect(parseRetryAfter(new Date(10_000).toUTCString(), 4_000)).toBe(6_000);
    expect(parseRetryAfter(undefined)).toBeNull();
    expect(parseRetryAfter('abc')).toBeNull();
  });
});
