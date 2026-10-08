/**
 * Datas locais (YYYY-MM-DD) sem fuso. No banco são colunas DATE; o Prisma as
 * representa como Date à meia-noite UTC. Toda conversão passa por aqui para
 * nunca aplicar o fuso do servidor.
 */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

export function isValidLocalDate(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return toLocalDate(d) === value;
}

/** "2026-12-24" → Date(2026-12-24T00:00:00Z) para gravar em coluna DATE. */
export function fromLocalDate(value: string): Date {
  if (!isValidLocalDate(value)) throw new Error(`Data local inválida: ${value}`);
  return new Date(`${value}T00:00:00.000Z`);
}

/** Date vinda de coluna DATE → "YYYY-MM-DD". */
export function toLocalDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(value: string, days: number): string {
  return toLocalDate(new Date(fromLocalDate(value).getTime() + days * DAY_MS));
}

/** Quantidade de dias no intervalo fechado [start, end]. */
export function daySpan(start: string, end: string): number {
  return Math.round((fromLocalDate(end).getTime() - fromLocalDate(start).getTime()) / DAY_MS) + 1;
}

/** Lista todas as datas do intervalo fechado [start, end]. */
export function datesInRange(start: string, end: string): string[] {
  const n = daySpan(start, end);
  return Array.from({ length: Math.max(n, 0) }, (_, i) => addDays(start, i));
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz.includes('/') || tz === 'UTC';
  } catch {
    return false;
  }
}
