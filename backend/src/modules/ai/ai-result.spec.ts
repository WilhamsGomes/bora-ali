import { normalizeAdjustment, normalizeSuggestions } from './ai-result';

const days = [
  { id: 'd1', date: '2026-12-20', activities: [{ id: 'a1', version: 3 }] },
  { id: 'd2', date: '2026-12-21', activities: [] },
];

const suggestion = (over: Record<string, unknown> = {}) => ({
  date: '2026-12-20',
  time: '10:00',
  title: 'Museu',
  durationMinutes: 90,
  category: 'passeio' as const,
  location: null,
  notes: null,
  reason: 'r',
  estimatedCost: { amount: 15, currency: 'eur', note: 'aprox.' },
  ...over,
});

describe('normalização da saída da IA', () => {
  it('descarta sugestões fora do escopo ou malformadas e força estado não verificado', () => {
    const res = normalizeSuggestions(
      {
        suggestions: [
          suggestion(),
          suggestion({ date: '2027-01-01' }), // fora da viagem
          suggestion({ time: '25:00' }), // horário inválido
          suggestion({ title: '   ' }),
          suggestion({ category: 'compras' }),
        ],
        notes: ['ok'],
      },
      days,
    );
    expect(res.suggestions).toHaveLength(1);
    expect(res.discarded).toBe(4);
    expect(res.suggestions[0]).toMatchObject({
      dayId: 'd1',
      estimatedCost: { amount: 15, currency: 'EUR' },
      verification: { status: 'UNVERIFIED', sources: [] },
    });
  });

  it('só aceita mudanças sobre atividades existentes e registra a versão de base', () => {
    const activity = { title: 'X', time: '11:00', durationMinutes: null, category: 'passeio' as const, location: null, notes: null };
    const res = normalizeAdjustment(
      {
        summary: 's',
        changes: [
          { type: 'update', date: '2026-12-20', activityId: 'a1', activity, reason: 'r' },
          { type: 'remove', date: '2026-12-20', activityId: 'inventada', activity: null, reason: 'r' },
          { type: 'add', date: '2026-12-21', activityId: null, activity, reason: 'r' },
          { type: 'add', date: '2026-12-21', activityId: null, activity: null, reason: 'r' },
        ],
        notes: [],
      },
      days,
    );
    expect(res.changes.map((c) => [c.type, c.activityId, c.baseVersion])).toEqual([
      ['update', 'a1', 3],
      ['add', null, null],
    ]);
    expect(res.discarded).toBe(2);
  });
});
