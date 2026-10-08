import { computeOverlaps, sortActivities } from './itinerary.mapper';

const at = (id: string, time: number, duration: number | null, position = 0) => ({
  id,
  title: id,
  startMinutes: time,
  durationMinutes: duration,
  position,
  createdAt: new Date(0),
});

describe('itinerary.mapper', () => {
  it('ordena por horário e desempata pela posição', () => {
    const sorted = sortActivities([at('c', 600, null, 1), at('a', 480, null), at('b', 600, null, 0)]);
    expect(sorted.map((a) => a.id)).toEqual(['a', 'b', 'c']);
  });

  it('só avisa sobreposição quando há duração definida', () => {
    expect(computeOverlaps([at('a', 600, null), at('b', 630, null)])).toEqual([]);
    expect(computeOverlaps([at('a', 600, 60), at('b', 660, 30)])).toEqual([]); // encosta, não sobrepõe
    const w = computeOverlaps([at('a', 600, 90), at('b', 630, null), at('c', 700, null)]);
    expect(w.map((x) => [x.activityId, x.overlapsWithActivityId])).toEqual([['a', 'b']]);
  });

  it('mesmo horário com duração em qualquer uma conta como sobreposição', () => {
    expect(computeOverlaps([at('a', 600, null, 0), at('b', 600, 30, 1)])).toHaveLength(1);
  });
});
