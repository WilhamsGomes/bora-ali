import { AppConfig } from './app-config.service';
import { validateEnv } from './env';

const base = { DATABASE_URL: 'postgresql://x', JWT_ACCESS_SECRET: 'x'.repeat(32) };

describe('configuração de ambiente', () => {
  it('converte tipos e trata opcionais vazios como ausentes', () => {
    const env = validateEnv({ ...base, RUN_WORKERS: 'false', CORS_ORIGINS: 'http://a, http://b', RESEND_API_KEY: '' });
    expect(env.RUN_WORKERS).toBe(false);
    expect(env.CORS_ORIGINS).toEqual(['http://a', 'http://b']);
    expect(env.RESEND_API_KEY).toBeUndefined();
  });

  it('AppConfig devolve o valor validado, não a string crua do process.env', () => {
    const saved = { ...process.env };
    process.env = { ...base, RESEND_API_KEY: '', RUN_WORKERS: 'false' };
    try {
      const config = new AppConfig();
      expect(config.get('RESEND_API_KEY')).toBeUndefined();
      expect(config.get('RUN_WORKERS')).toBe(false);
    } finally {
      process.env = saved;
    }
  });

  it('recusa mock de IA e e-mail de dev em produção, e segredo JWT curto', () => {
    expect(() => validateEnv({ ...base, NODE_ENV: 'production', AI_PROVIDER: 'mock' })).toThrow(/AI_PROVIDER/);
    expect(() => validateEnv({ ...base, NODE_ENV: 'production', EMAIL_PROVIDER: 'dev' })).toThrow(/EMAIL_PROVIDER/);
    expect(() => validateEnv({ DATABASE_URL: 'x', JWT_ACCESS_SECRET: 'curto' })).toThrow(/JWT_ACCESS_SECRET/);
  });
});
