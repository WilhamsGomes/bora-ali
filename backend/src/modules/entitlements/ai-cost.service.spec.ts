import { AppConfig } from '../../config/app-config.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AiCostService } from './ai-cost.service';

function service(env: Record<string, string> = {}) {
  const saved = { ...process.env };
  process.env = { DATABASE_URL: 'postgresql://x', JWT_ACCESS_SECRET: 'x'.repeat(32), AI_PROVIDER: 'anthropic', ...env };
  try {
    return new AiCostService({} as PrismaService, new AppConfig());
  } finally {
    process.env = saved;
  }
}

const usage = (i: number | null, o: number | null, cw: number | null = null, cr: number | null = null) => ({
  inputTokens: i,
  outputTokens: o,
  cacheCreationInputTokens: cw,
  cacheReadInputTokens: cr,
});

describe('AiCostService', () => {
  it('calcula custo pelo modelo efetivo, incluindo cache', () => {
    const s = service();
    // Opus 5.5: entrada 4, saída 20, escrita de cache 5, leitura 0.20 (USD/MTok) → micro-USD = tokens × preço
    expect(s.costFromUsage('claude-opus-5-5', usage(1000, 500, 2000, 10_000), 'anthropic')).toEqual({
      status: 'ESTIMATED',
      costMicros: 1000 * 4 + 500 * 20 + 2000 * 5 + 10_000 * 0.2,
    });
    expect(s.costFromUsage('claude-haiku-4-5-20251001', usage(1000, 1000), 'anthropic')).toEqual({
      status: 'ESTIMATED',
      costMicros: 1000 + 5000,
    });
  });

  it('sem dados marca como desconhecido, nunca zero', () => {
    const s = service();
    expect(s.costFromUsage('claude-opus-5-5', usage(null, 500), 'anthropic')).toEqual({ status: 'UNKNOWN' });
    expect(s.costFromUsage('modelo-sem-preco', usage(10, 10), 'anthropic')).toEqual({ status: 'UNKNOWN' });
    expect(s.costFromUsage(null, usage(10, 10), 'anthropic')).toEqual({ status: 'UNKNOWN' });
  });

  it('provedor simulado não gera custo', () => {
    const s = service();
    expect(s.costFromUsage('mock-planner', usage(0, 0), 'mock')).toEqual({ status: 'ESTIMATED', costMicros: 0 });
    expect(s.estimateReservation(10_000, 'claude-opus-5-5', 'mock')).toBe(0);
  });

  it('reserva conservadora: entrada estimada + saída máxima, sem desconto de cache', () => {
    const s = service({ AI_MAX_OUTPUT_TOKENS: '8000' });
    // 4000 caracteres → 2000 tokens + 1500 de folga = 3500 × 4 + 8000 × 20
    expect(s.estimateReservation(4000, 'claude-opus-5-5', 'anthropic')).toBe(3500 * 4 + 8000 * 20);
    expect(s.currency).toBe('USD');
    expect(s.referenceDate).toBe('2026-10-07');
    expect(s.budgetMicros).toBe(1_500_000);
  });
});
