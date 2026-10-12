/** Fuso do destino, adivinhado pelo nome. O padrão é o horário de Brasília. */
export const DEFAULT_TIME_ZONE = "America/Sao_Paulo";

const known: [RegExp, string][] = [
  [/lisboa|porto|portugal/i, "Europe/Lisbon"],
  [/madri|barcelona|espanha/i, "Europe/Madrid"],
  [/paris|fran[cç]a/i, "Europe/Paris"],
  [/roma|it[aá]lia/i, "Europe/Rome"],
  [/londres|inglaterra/i, "Europe/London"],
  [/buenos aires|argentina/i, "America/Argentina/Buenos_Aires"],
  [/santiago|chile/i, "America/Santiago"],
  [/nova york|new york/i, "America/New_York"],
  [/manaus|amazonas/i, "America/Manaus"],
  [/fernando de noronha|noronha/i, "America/Noronha"],
  [/fortaleza|recife|salvador|natal|macei[oó]|jo[aã]o pessoa|bel[eé]m|bahia|cear[aá]|pernambuco/i, "America/Fortaleza"],
];

/** Fusos oferecidos nos formulários (o adivinhado pelo destino entra como sugestão). */
export const timeZoneOptions: { value: string; label: string }[] = [
  { value: "America/Sao_Paulo", label: "Brasília (São Paulo, Rio, Sul e Sudeste)" },
  { value: "America/Fortaleza", label: "Nordeste (Fortaleza, Salvador, Recife)" },
  { value: "America/Manaus", label: "Amazonas (Manaus)" },
  { value: "America/Noronha", label: "Fernando de Noronha" },
  { value: "America/Argentina/Buenos_Aires", label: "Buenos Aires" },
  { value: "America/Santiago", label: "Santiago" },
  { value: "America/New_York", label: "Nova York" },
  { value: "Europe/Lisbon", label: "Lisboa e Porto" },
  { value: "Europe/London", label: "Londres" },
  { value: "Europe/Madrid", label: "Madri e Barcelona" },
  { value: "Europe/Paris", label: "Paris" },
  { value: "Europe/Rome", label: "Roma" },
];

export function timeZoneLabel(timeZone: string) {
  return timeZoneOptions.find((o) => o.value === timeZone)?.label ?? timeZone;
}

export function timeZoneForDestination(destination: string) {
  return known.find(([re]) => re.test(destination))?.[1] ?? DEFAULT_TIME_ZONE;
}

/** Data (YYYY-MM-DD) e minutos do dia no fuso informado. */
export function nowInTimeZone(timeZone: string, now: Date) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
    return { date: `${get("year")}-${get("month")}-${get("day")}`, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
  } catch {
    return { date: now.toISOString().slice(0, 10), minutes: now.getHours() * 60 + now.getMinutes() };
  }
}

/** "GMT-3" */
export function offsetLabel(timeZone: string, now: Date) {
  try {
    const parts = new Intl.DateTimeFormat("pt-BR", { timeZone, timeZoneName: "shortOffset" }).formatToParts(now);
    return parts.find((p) => p.type === "timeZoneName")?.value ?? timeZone;
  } catch {
    return timeZone;
  }
}
