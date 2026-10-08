import { randomUUID } from 'node:crypto';
import { ActivityCategory } from '@prisma/client';
import { isValidLocalDate } from '../../common/utils/local-date';
import { TIME_RE } from '../../common/utils/local-time';
import type { ModelAdjustOutput, ModelSuggestionsOutput } from './ai.schemas';

/**
 * Estado de verificação das informações. Sem ferramenta de busca/fonte, tudo
 * que a IA diz sobre preços, horários e funcionamento é UNVERIFIED — o
 * servidor impõe isso independentemente do que o modelo responder.
 */
export interface Verification {
  status: 'UNVERIFIED' | 'VERIFIED';
  sources: { title: string; url: string }[];
  note: string;
}

export const UNVERIFIED: Verification = {
  status: 'UNVERIFIED',
  sources: [],
  note: 'Horários, preços e funcionamento não foram verificados. Confirme antes de ir.',
};

export interface SuggestedActivity {
  suggestionId: string;
  dayId: string;
  date: string;
  title: string;
  time: string;
  durationMinutes: number | null;
  category: ActivityCategory;
  location: string | null;
  notes: string | null;
  reason: string;
  estimatedCost: { amount: number | null; currency: string | null; note: string | null } | null;
  verification: Verification;
}

export interface SuggestionsResult {
  type: 'suggestions';
  suggestions: SuggestedActivity[];
  notes: string[];
  discarded: number;
}

export interface ProposedChange {
  changeId: string;
  type: 'add' | 'update' | 'remove';
  dayId: string;
  date: string;
  /** update/remove: atividade alvo e versão em que a proposta se baseou (use no PATCH/DELETE). */
  activityId: string | null;
  baseVersion: number | null;
  activity: Omit<SuggestedActivity, 'suggestionId' | 'dayId' | 'date' | 'reason' | 'estimatedCost' | 'verification'> | null;
  reason: string;
  verification: Verification;
}

export interface AdjustmentResult {
  type: 'adjustment';
  summary: string;
  changes: ProposedChange[];
  notes: string[];
  discarded: number;
}

export type AiJobResult = SuggestionsResult | AdjustmentResult;

interface DayRef {
  id: string;
  date: string;
  activities: { id: string; version: number }[];
}

const CATEGORIES = new Set<string>(Object.values(ActivityCategory));

function clean(value: string | null | undefined, max: number): string | null {
  const v = value?.trim();
  return v ? v.slice(0, max) : null;
}

function normalizeActivity(a: {
  title: string;
  time: string;
  durationMinutes: number | null;
  category: string;
  location: string | null;
  notes: string | null;
}) {
  const title = clean(a.title, 200);
  if (!title || !TIME_RE.test(a.time) || !CATEGORIES.has(a.category)) return null;
  const duration =
    a.durationMinutes && Number.isInteger(a.durationMinutes) && a.durationMinutes > 0 && a.durationMinutes <= 1440
      ? a.durationMinutes
      : null;
  return {
    title,
    time: a.time,
    durationMinutes: duration,
    category: a.category as ActivityCategory,
    location: clean(a.location, 300),
    notes: clean(a.notes, 2000),
  };
}

/** Mantém apenas sugestões válidas e dentro dos dias pedidos. */
export function normalizeSuggestions(
  output: ModelSuggestionsOutput,
  days: DayRef[],
  maxPerDay = Number.POSITIVE_INFINITY,
): SuggestionsResult {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const suggestions: SuggestedActivity[] = [];
  const perDay = new Map<string, number>();
  for (const s of output.suggestions) {
    const day = isValidLocalDate(s.date) ? byDate.get(s.date) : undefined;
    const activity = normalizeActivity(s);
    if (!day || !activity) continue;
    // Limite de atividades devolvidas por dia; o excedente conta como descartado.
    if ((perDay.get(day.id) ?? 0) >= maxPerDay) continue;
    perDay.set(day.id, (perDay.get(day.id) ?? 0) + 1);
    const cost = s.estimatedCost;
    suggestions.push({
      suggestionId: randomUUID(),
      dayId: day.id,
      date: day.date,
      ...activity,
      reason: clean(s.reason, 500) ?? '',
      estimatedCost: cost
        ? {
            amount: typeof cost.amount === 'number' && cost.amount >= 0 ? cost.amount : null,
            currency: cost.currency && /^[A-Za-z]{3}$/.test(cost.currency) ? cost.currency.toUpperCase() : null,
            note: clean(cost.note, 300),
          }
        : null,
      verification: UNVERIFIED,
    });
  }
  suggestions.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  return {
    type: 'suggestions',
    suggestions,
    notes: output.notes.map((n) => clean(n, 500)).filter((n): n is string => !!n).slice(0, 10),
    discarded: output.suggestions.length - suggestions.length,
  };
}

/** Mantém apenas mudanças coerentes com o roteiro atual (IDs existentes, dias da viagem). */
export function normalizeAdjustment(
  output: ModelAdjustOutput,
  days: DayRef[],
  maxChanges = Number.POSITIVE_INFINITY,
): AdjustmentResult {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const versions = new Map(days.flatMap((d) => d.activities.map((a) => [a.id, a.version] as const)));
  const changes: ProposedChange[] = [];
  for (const c of output.changes) {
    if (changes.length >= maxChanges) break;
    const day = isValidLocalDate(c.date) ? byDate.get(c.date) : undefined;
    if (!day) continue;
    const needsTarget = c.type !== 'add';
    if (needsTarget && (!c.activityId || !versions.has(c.activityId))) continue;
    const activity = c.type === 'remove' ? null : c.activity ? normalizeActivity(c.activity) : null;
    if (c.type !== 'remove' && !activity) continue;
    changes.push({
      changeId: randomUUID(),
      type: c.type,
      dayId: day.id,
      date: day.date,
      activityId: needsTarget ? c.activityId : null,
      baseVersion: needsTarget ? versions.get(c.activityId!)! : null,
      activity,
      reason: clean(c.reason, 500) ?? '',
      verification: UNVERIFIED,
    });
  }
  return {
    type: 'adjustment',
    summary: clean(output.summary, 1000) ?? '',
    changes,
    notes: output.notes.map((n) => clean(n, 500)).filter((n): n is string => !!n).slice(0, 10),
    discarded: output.changes.length - changes.length,
  };
}
