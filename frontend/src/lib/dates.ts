/** Utilitários de data sem fuso: tudo trabalha com strings YYYY-MM-DD. */

function parse(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

function fmt(date: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", ...options }).format(parse(date));
}

/** "16 de out." */
export function shortDate(date: string) {
  return fmt(date, { day: "numeric", month: "short" });
}

/** "sábado, 17 de outubro" */
export function longDate(date: string) {
  return fmt(date, { weekday: "long", day: "numeric", month: "long" });
}

/** "sex" */
export function weekdayShort(date: string) {
  return fmt(date, { weekday: "short" }).replace(".", "");
}

export function dayOfMonth(date: string) {
  return parse(date).getUTCDate();
}

export function monthShort(date: string) {
  return fmt(date, { month: "short" }).replace(".", "");
}

/** "16 a 19 de outubro de 2026" (ou com meses/anos diferentes) */
export function dateRange(start: string, end: string) {
  const s = parse(start);
  const e = parse(end);
  const sameYear = s.getUTCFullYear() === e.getUTCFullYear();
  const sameMonth = sameYear && s.getUTCMonth() === e.getUTCMonth();
  if (start === end) return fmt(start, { day: "numeric", month: "long", year: "numeric" });
  if (sameMonth) {
    return `${s.getUTCDate()} a ${fmt(end, { day: "numeric", month: "long", year: "numeric" })}`;
  }
  if (sameYear) {
    return `${fmt(start, { day: "numeric", month: "long" })} a ${fmt(end, { day: "numeric", month: "long", year: "numeric" })}`;
  }
  return `${fmt(start, { day: "numeric", month: "short", year: "numeric" })} a ${fmt(end, { day: "numeric", month: "short", year: "numeric" })}`;
}

export function addDays(date: string, n: number) {
  const d = parse(date);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(start: string, end: string) {
  return Math.round((parse(end).getTime() - parse(start).getTime()) / 86_400_000);
}

export function eachDay(start: string, end: string) {
  const total = daysBetween(start, end);
  return Array.from({ length: Math.max(total, 0) + 1 }, (_, i) => addDays(start, i));
}

export function todayISO(now: Date) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/* Horários */

export function toMinutes(time: string) {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export function fromMinutes(total: number) {
  const t = ((total % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

/** "1h30", "45 min", "3h" */
export function formatDuration(min?: number) {
  if (!min) return "";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
}

/** "Sábado, 17 de outubro" — maiúscula feita no texto (a geração de PNG ignora ::first-letter) */
export function longDateTitle(date: string) {
  const s = longDate(date);
  return s.charAt(0).toUpperCase() + s.slice(1);
}
