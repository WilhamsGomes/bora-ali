/**
 * Avaliação OPCIONAL de custo da IA — faz chamadas PAGAS à API da Anthropic.
 *
 * Mede: uma sugestão de dia, uma viagem curta (3 dias, em blocos de AI_DAYS_PER_CALL)
 * e um ajuste. Registra tokens, duração, status e custo estimado, e projeta o
 * custo de uma viagem que use todas as cotas configuradas.
 *
 *   npm run ai:eval -- --confirm-paid-calls [--model claude-sonnet-5-5] [--out ai-eval.json]
 *
 * Exige a flag explícita e ANTHROPIC_API_KEY. Nunca roda em testes, build ou CI.
 * Uma execução padrão faz 1 + ceil(3 / AI_DAYS_PER_CALL) + 1 chamadas (5 com os padrões).
 */
import { existsSync, writeFileSync } from 'node:fs';
import type { PrismaService } from '../src/prisma/prisma.service';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

async function main() {
  if (!args.includes('--confirm-paid-calls')) {
    console.error('Este script faz chamadas PAGAS à API da Anthropic. Rode com --confirm-paid-calls para confirmar.');
    process.exitCode = 1;
    return;
  }
  if (process.env.CI || process.env.NODE_ENV === 'test') {
    console.error('Recusado: não execute a avaliação paga em CI ou testes.');
    process.exitCode = 1;
    return;
  }
  if (existsSync('.env')) process.loadEnvFile('.env');
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Defina ANTHROPIC_API_KEY (no ambiente ou no .env).');
    process.exitCode = 1;
    return;
  }
  process.env.AI_PROVIDER = 'anthropic';
  if (flag('--model')) process.env.AI_MODEL = flag('--model');

  // Imports tardios: a configuração é validada ao construir AppConfig.
  const { AppConfig } = await import('../src/config/app-config.service');
  const { AiCostService } = await import('../src/modules/entitlements/ai-cost.service');
  const { AnthropicProvider } = await import('../src/modules/ai/anthropic.provider');
  const { buildUserPrompt, SYSTEM_PROMPT } = await import('../src/modules/ai/prompts');
  type AiTask = import('../src/modules/ai/ai-provider').AiTask;

  const config = new AppConfig();
  const cost = new AiCostService({} as PrismaService, config);
  const provider = new AnthropicProvider(config);
  const model = config.get('AI_MODEL');
  const entry = cost.entryFor(model);
  const limits = { maxSuggestionsPerDay: config.get('AI_MAX_SUGGESTIONS_PER_DAY'), maxChanges: config.get('AI_MAX_ADJUST_CHANGES') };
  const trip = {
    name: 'Avaliação BoraAli',
    destination: 'Lisboa, Portugal',
    timeZone: 'Europe/Lisbon',
    stay: 'Alfama',
    startDate: '2026-12-20',
    endDate: '2026-12-22',
  };
  const day = (date: string, activities: [string, string, string, number | null][] = []) => ({
    date,
    title: null,
    omittedActivities: 0,
    activities: activities.map(([time, title, category, durationMinutes], i) => ({
      id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}${date.slice(-2)}`.slice(0, 36),
      version: 1,
      time,
      title,
      category,
      durationMinutes,
      location: null,
    })),
  });
  const preferences = { interests: ['gastronomia', 'museus'], pace: 'equilibrado' as const, budget: 'moderado' as const };
  const d1 = day('2026-12-20', [['10:00', 'Mosteiro dos Jerónimos', 'passeio', 90]]);
  const d2 = day('2026-12-21');
  const d3 = day('2026-12-22', [['20:00', 'Jantar com fado', 'alimentacao', 120]]);

  const perCall = config.get('AI_DAYS_PER_CALL');
  const tripDays = [d1, d2, d3];
  const scenarios: { kind: 'DAY_SUGGESTIONS' | 'TRIP_SUGGESTIONS' | 'ADJUST_ITINERARY'; tasks: AiTask[] }[] = [
    { kind: 'DAY_SUGGESTIONS', tasks: [{ type: 'suggest', trip, days: [d1], preferences, limits }] },
    {
      kind: 'TRIP_SUGGESTIONS',
      tasks: Array.from({ length: Math.ceil(tripDays.length / perCall) }, (_, i) => ({
        type: 'suggest' as const,
        trip,
        days: tripDays.slice(i * perCall, (i + 1) * perCall),
        preferences,
        limits,
      })),
    },
    {
      kind: 'ADJUST_ITINERARY',
      tasks: [{ type: 'adjust', trip, days: [d1, d3], instruction: 'Deixe o primeiro dia mais tranquilo e inclua um almoço.', limits }],
    },
  ];

  console.log(`Modelo: ${model} · effort: ${entry?.supportsEffort ? config.get('AI_EFFORT') : 'n/d'} · máx. saída: ${config.get('AI_MAX_OUTPUT_TOKENS')} tokens`);
  console.log(`Preços: ${cost.currency}, referência ${cost.referenceDate}\n`);

  const rows: Record<string, unknown>[] = [];
  const perKind: Record<string, number | null> = {};
  for (const scenario of scenarios) {
    let total: number | null = 0;
    for (const [i, task] of scenario.tasks.entries()) {
      const started = Date.now();
      const reservation = cost.estimateReservation(SYSTEM_PROMPT.length + buildUserPrompt(task).length, model, provider.name);
      try {
        const res = await provider.attempt(task, {
          model,
          maxOutputTokens: config.get('AI_MAX_OUTPUT_TOKENS'),
          effort: entry?.supportsEffort ? config.get('AI_EFFORT') : undefined,
        });
        const c = cost.costFromUsage(res.model, res.usage, provider.name);
        const micros = c.status === 'ESTIMATED' ? c.costMicros : null;
        total = total === null || micros === null ? null : total + micros;
        rows.push({
          scenario: scenario.kind,
          call: i + 1,
          status: res.status,
          model: res.model,
          ...res.usage,
          durationMs: Date.now() - started,
          costStatus: c.status,
          costMicros: micros,
          reservedMicros: reservation,
          items: res.status === 'success' ? ('suggestions' in res.data ? res.data.suggestions.length : res.data.changes.length) : null,
        });
      } catch (err) {
        total = null; // falha: custo desconhecido, não zero
        rows.push({ scenario: scenario.kind, call: i + 1, status: 'error', error: (err as Error).message, durationMs: Date.now() - started, costStatus: 'UNKNOWN' });
      }
    }
    perKind[scenario.kind] = total;
  }

  console.table(
    rows.map((r) => ({
      cenário: r.scenario,
      chamada: r.call,
      status: r.status,
      entrada: r.inputTokens,
      saída: r.outputTokens,
      'cache (escrita/leitura)': `${r.cacheCreationInputTokens ?? '-'}/${r.cacheReadInputTokens ?? '-'}`,
      ms: r.durationMs,
      custo: r.costMicros === null || r.costMicros === undefined ? 'desconhecido' : `${(Number(r.costMicros) / 1e6).toFixed(4)} ${cost.currency}`,
      reserva: r.reservedMicros ? `${(Number(r.reservedMicros) / 1e6).toFixed(4)}` : '-',
      itens: r.items ?? '-',
    })),
  );

  const quotas = {
    DAY_SUGGESTIONS: config.get('AI_LIMIT_DAY_SUGGESTIONS'),
    TRIP_SUGGESTIONS: config.get('AI_LIMIT_TRIP_SUGGESTIONS'),
    ADJUST_ITINERARY: config.get('AI_LIMIT_ADJUST_ITINERARY'),
  };
  const known = Object.values(perKind).every((v) => v !== null);
  const projection = known
    ? Object.entries(quotas).reduce((n, [k, q]) => n + q * (perKind[k] as number), 0)
    : null;
  console.log('\nProjeção (amostra única — não é média; repita a avaliação antes de decidir):');
  console.log(`  Viagem usando todas as cotas (${JSON.stringify(quotas)}): ${projection === null ? 'desconhecida' : `${(projection / 1e6).toFixed(4)} ${cost.currency}`}`);
  console.log(`  Orçamento interno por viagem (AI_TRIP_BUDGET): ${config.get('AI_TRIP_BUDGET')} ${cost.currency}`);

  const out = flag('--out');
  if (out) {
    writeFileSync(
      out,
      JSON.stringify({ ranAt: new Date().toISOString(), model, currency: cost.currency, pricingReferenceDate: cost.referenceDate, rows, perKind, quotas, projection }, null, 2),
    );
    console.log(`\nRelatório salvo em ${out}`);
  }
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exitCode = 1;
});
