import { fromMinutes, toMinutes } from "./dates";
import type { Activity, ActivityContent } from "./types";

/**
 * Regras de ordem do roteiro (as mesmas do backend):
 * 1. Atividades ficam sempre ordenadas pelo horário.
 * 2. Atividades com o mesmo horário seguem a posição (desempate escolhido pelo usuário).
 * 3. Reordenar só troca atividades do mesmo horário; nunca altera horários.
 */
export function sortByTime<T extends ActivityContent & { position?: number }>(list: T[]): T[] {
  return list
    .map((a, i) => [a, i] as const)
    .sort(([a, i], [b, j]) => toMinutes(a.time) - toMinutes(b.time) || (a.position ?? i) - (b.position ?? j) || i - j)
    .map(([a]) => a);
}

/** Pode mover para cima/baixo apenas quando o vizinho tem o mesmo horário. */
export function moveOptions(list: ActivityContent[], index: number) {
  const a = list[index];
  return {
    up: index > 0 && list[index - 1].time === a.time,
    down: index < list.length - 1 && list[index + 1].time === a.time,
  };
}

/** Nova ordem do dia trocando a atividade com a vizinha de mesmo horário. */
export function swapSameTime(list: Activity[], index: number, direction: -1 | 1): Activity[] {
  const target = index + direction;
  if (target < 0 || target >= list.length || list[target].time !== list[index].time) return list;
  const next = [...list];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function endMinutes(a: Pick<ActivityContent, "time" | "durationMin">) {
  return a.durationMin ? toMinutes(a.time) + a.durationMin : null;
}

export function endTime(a: Pick<ActivityContent, "time" | "durationMin">) {
  const end = endMinutes(a);
  return end === null ? null : fromMinutes(end);
}

/**
 * Encontra a primeira atividade que se sobrepõe a `a` (só faz sentido com duração definida).
 * Sobreposição: outra atividade começa antes de `a` terminar, ou `a` começa durante outra.
 */
export function findOverlap<T extends ActivityContent>(
  a: Pick<ActivityContent, "id" | "time" | "durationMin">,
  others: T[],
): T | null {
  const start = toMinutes(a.time);
  const end = endMinutes(a);
  for (const o of others) {
    if (o.id === a.id) continue;
    const oStart = toMinutes(o.time);
    const oEnd = endMinutes(o);
    const startsInsideA = end !== null && oStart >= start && oStart < end;
    const aStartsInsideO = oEnd !== null && start >= oStart && start < oEnd;
    if (startsInsideA || aStartsInsideO) return o;
  }
  return null;
}

/** Mapa id → atividade com a qual se sobrepõe (para avisos discretos na linha do tempo). */
export function overlapMap<T extends ActivityContent>(list: T[]) {
  const map: Record<string, T> = {};
  for (const a of list) {
    if (!a.durationMin) continue;
    const later = list.filter((o) => o.id !== a.id && toMinutes(o.time) >= toMinutes(a.time));
    const hit = findOverlap(a, later);
    if (hit) map[a.id] = hit;
  }
  return map;
}
