import { ConsoleLogger } from '@nestjs/common';
import { createAppLogger, logLevelsFor, sanitizeUrl, withFields } from './logging';
import { validateEnv } from '../config/env';

describe('logging', () => {
  it('formata campos no padrão de texto do Nest', () => {
    expect(withFields('Pedido reconciliado', { orderId: 'o1', outcome: 'paid', skip: undefined })).toBe(
      'Pedido reconciliado (orderId=o1, outcome=paid)',
    );
    expect(withFields('Sem campos', {})).toBe('Sem campos');
    expect(withFields('Objeto', { a: { b: 1 }, n: null })).toBe('Objeto (a={"b":1}, n=null)');
  });

  it('mapeia LOG_LEVEL para os níveis do Nest', () => {
    expect(logLevelsFor('log')).toEqual(['log', 'warn', 'error', 'fatal']);
    expect(logLevelsFor('verbose')).toEqual(['verbose', 'debug', 'log', 'warn', 'error', 'fatal']);
    expect(logLevelsFor('silent')).toEqual([]);
  });

  it('aceita os nomes antigos de nível e o formato', () => {
    const base = { DATABASE_URL: 'postgresql://x', JWT_ACCESS_SECRET: 'x'.repeat(32) };
    expect(validateEnv({ ...base, LOG_LEVEL: 'info' }).LOG_LEVEL).toBe('log');
    expect(validateEnv({ ...base, LOG_LEVEL: 'trace' }).LOG_LEVEL).toBe('verbose');
    expect(validateEnv(base)).toMatchObject({ LOG_LEVEL: 'log', LOG_FORMAT: 'pretty' });
  });

  it('usa o ConsoleLogger do Nest (colorido por padrão, JSON opcional)', () => {
    const options = (l: ConsoleLogger) => (l as unknown as { options: Record<string, unknown> }).options;
    const pretty = createAppLogger({ LOG_LEVEL: 'log', LOG_FORMAT: 'pretty' });
    expect(pretty).toBeInstanceOf(ConsoleLogger);
    expect(options(pretty)).toMatchObject({ json: false, colors: true });
    expect(options(createAppLogger({ LOG_LEVEL: 'log', LOG_FORMAT: 'json' }))).toMatchObject({ json: true, colors: false });
  });

  it('esconde tokens em URLs', () => {
    expect(sanitizeUrl('/api/v1/public/trips/abc123?x=1')).toBe('/api/v1/public/trips/[REDACTED]?x=1');
    expect(sanitizeUrl('/a?token=segredo&b=2')).toBe('/a?token=[REDACTED]&b=2');
  });
});
