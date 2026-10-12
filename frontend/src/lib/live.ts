import { endMinutes } from "./activities";
import { toMinutes } from "./dates";
import type { ActivityContent as Activity } from "./types";

export type LiveCardState = "past" | "now" | "next" | "future";

export type LiveStatus =
  | { kind: "empty" }
  /** Antes da primeira atividade do dia */
  | { kind: "before"; next: Activity }
  /** Uma atividade com duração está acontecendo */
  | { kind: "in-progress"; current: Activity; progress: number; next: Activity | null }
  /** Entre compromissos. `previous` é a última atividade que já começou. */
  | { kind: "free"; previous: Activity; next: Activity }
  /** Nada mais programado para o dia */
  | { kind: "ended"; previous: Activity };

export interface LiveInfo {
  status: LiveStatus;
  states: Record<string, LiveCardState>;
}

/**
 * Calcula o que acontece no minuto informado. Só atividades com duração ficam
 * "em andamento"; as demais são compromissos pontuais e não se estendem sozinhas.
 */
export function computeLive(activities: Activity[], minutes: number): LiveInfo {
  const states: Record<string, LiveCardState> = {};
  if (activities.length === 0) return { status: { kind: "empty" }, states };

  const started = activities.filter((a) => toMinutes(a.time) <= minutes);
  const upcoming = activities.filter((a) => toMinutes(a.time) > minutes);
  const next = upcoming[0] ?? null;

  // Em andamento: a que começou mais recentemente entre as que ainda não terminaram
  const running = [...started].reverse().find((a) => {
    const end = endMinutes(a);
    return end !== null && minutes < end;
  });

  for (const a of activities) {
    if (running && a.id === running.id) states[a.id] = "now";
    else if (next && a.id === next.id) states[a.id] = "next";
    else states[a.id] = toMinutes(a.time) <= minutes ? "past" : "future";
  }

  if (running) {
    const start = toMinutes(running.time);
    const end = endMinutes(running)!;
    return {
      status: { kind: "in-progress", current: running, progress: (minutes - start) / Math.max(end - start, 1), next },
      states,
    };
  }
  if (started.length === 0) return { status: { kind: "before", next: next! }, states };
  const previous = started[started.length - 1];
  if (next) return { status: { kind: "free", previous, next }, states };
  return { status: { kind: "ended", previous }, states };
}

/** Link de busca do Google Maps (sem API): local + destino da viagem. */
export function mapsSearchUrl(location: string, destination: string) {
  const query = `${location}, ${destination}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
