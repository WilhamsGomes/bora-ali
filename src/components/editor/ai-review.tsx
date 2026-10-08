"use client";

import { ArrowRight, Check, CircleAlert, LoaderCircle, MapPin, Minus, Pencil, Plus, ShieldQuestion, TriangleAlert } from "lucide-react";
import { useRef, useState } from "react";
import { errorMessage, isApiError } from "@/api/client";
import type { AiJobDto, ProposedChangeDto, SuggestedActivityDto } from "@/api/contracts";
import { itineraryApi } from "@/api/endpoints";
import { fromProposed, toActivityInput } from "@/api/mappers";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { categories } from "@/lib/categories";
import { formatDuration, longDateTitle } from "@/lib/dates";
import { plural } from "@/lib/format";
import type { Activity, Trip } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Itens já aplicados por trabalho (evita reenviar com cliques repetidos ou ao reabrir o painel). */
const applied = new Map<string, Set<string>>();
function appliedFor(jobId: string) {
  if (!applied.has(jobId)) applied.set(jobId, new Set());
  return applied.get(jobId)!;
}

const sameActivity = (trip: Trip, s: { dayId: string; time: string; title: string }) =>
  trip.days
    .find((d) => d.id === s.dayId)
    ?.activities.some((a) => a.time === s.time && a.title.trim().toLowerCase() === s.title.trim().toLowerCase()) ?? false;

function Unverified({ note }: { note?: string }) {
  return (
    <span
      title={note}
      className="inline-flex items-center gap-1 rounded-full bg-[#fbf2df] px-2 py-0.5 text-[11px] font-semibold text-[#5c430c]"
    >
      <ShieldQuestion aria-hidden className="size-3" /> Não verificado
    </span>
  );
}

function costText(c: SuggestedActivityDto["estimatedCost"]) {
  if (c.amount !== null && c.currency) {
    const value = new Intl.NumberFormat("pt-BR", { style: "currency", currency: c.currency }).format(c.amount);
    return `Custo estimado: ${value}${c.note ? ` (${c.note})` : ""}`;
  }
  return c.note ? `Custo: ${c.note}` : null;
}

function ActivityLine({ a }: { a: { time: string; title: string; category: Activity["category"]; location?: string | null; durationMinutes?: number | null } }) {
  const cat = categories[a.category];
  const Icon = cat.icon;
  return (
    <div className="flex items-start gap-3">
      <span className="font-display text-base font-bold tabular-nums text-forest">{a.time}</span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold leading-snug text-ink wrap-anywhere">{a.title}</p>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-soft">
          <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-bold", cat.chip)}>
            <Icon aria-hidden className="size-3" /> {cat.label}
          </span>
          {a.location && (
            <span className="inline-flex items-center gap-1 wrap-anywhere">
              <MapPin aria-hidden className="size-3 shrink-0" /> {a.location}
            </span>
          )}
          {a.durationMinutes ? <span>{formatDuration(a.durationMinutes)}</span> : null}
        </p>
      </div>
    </div>
  );
}

function JobNotes({ job }: { job: AiJobDto }) {
  const r = job.result;
  if (!r) return null;
  return (
    <>
      {r.summary && <p className="text-sm text-ink">{r.summary}</p>}
      {r.notes.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink-soft">
          {r.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      {r.discarded > 0 && (
        <p className="text-xs text-ink-soft">
          {plural(r.discarded, "item foi descartado", "itens foram descartados")} por não passar na conferência (datas, horários ou
          limites).
        </p>
      )}
    </>
  );
}

/* ───────────────────────────── Sugestões ───────────────────────────── */

export function SuggestionsReview({
  job,
  trip,
  onApplied,
  renderLimit,
}: {
  job: AiJobDto;
  trip: Trip;
  onApplied: () => Promise<unknown>;
  renderLimit: () => React.ReactNode;
}) {
  const toast = useToast();
  const suggestions = job.result?.suggestions ?? [];
  const done = appliedFor(job.id);
  const isDone = (s: SuggestedActivityDto) => done.has(s.suggestionId) || sameActivity(trip, s);
  const canEdit = trip.role !== "VIEWER";
  const [selected, setSelected] = useState<Set<string>>(() => new Set(suggestions.filter((s) => !isDone(s)).map((s) => s.suggestionId)));
  const [busy, setBusy] = useState(false);
  const [limitHit, setLimitHit] = useState(false);
  const [, force] = useState(0);
  const lock = useRef(false);

  const pending = suggestions.filter((s) => selected.has(s.suggestionId) && !isDone(s));
  const byDay = trip.days
    .map((d) => ({ day: d, items: suggestions.filter((s) => s.dayId === d.id) }))
    .filter((g) => g.items.length > 0);

  async function add() {
    if (lock.current || pending.length === 0) return;
    lock.current = true;
    setBusy(true);
    setLimitHit(false);
    try {
      await itineraryApi.batchCreate(
        trip.id,
        pending.map((s) => ({ dayId: s.dayId, ...toActivityInput(fromProposed(s)) })),
      );
      pending.forEach((s) => done.add(s.suggestionId));
      setSelected(new Set());
      await onApplied();
      toast.show(pending.length === 1 ? "Sugestão adicionada ao roteiro" : `${pending.length} sugestões adicionadas ao roteiro`);
    } catch (e) {
      if (isApiError(e, "DAILY_ACTIVITY_LIMIT_REACHED")) setLimitHit(true);
      else toast.show(`${errorMessage(e)} Nenhuma sugestão foi adicionada.`, { tone: "error" });
      await onApplied();
    }
    lock.current = false;
    setBusy(false);
    force((n) => n + 1);
  }

  if (suggestions.length === 0) {
    return (
      <div className="space-y-3 rounded-2xl border border-dashed border-line bg-white/70 p-5 text-center">
        <p className="font-display text-lg font-bold text-forest">Nenhuma sugestão desta vez</p>
        <JobNotes job={job} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <JobNotes job={job} />
      <p className="flex items-start gap-2 rounded-xl bg-cream-200/70 px-3 py-2 text-xs text-ink-soft">
        <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        Revise antes de adicionar: locais, preços e horários sugeridos pela IA não foram verificados.
      </p>
      {byDay.map(({ day, items }) => (
        <section key={day.id} aria-label={longDateTitle(day.date)} className="space-y-2">
          {byDay.length > 1 && <h4 className="text-sm font-bold text-forest">{longDateTitle(day.date)}</h4>}
          <ul className="space-y-2">
            {items.map((s) => {
              const added = isDone(s);
              const cost = costText(s.estimatedCost);
              return (
                <li key={s.suggestionId} className={cn("rounded-2xl border bg-white p-3.5", added ? "border-forest/30" : "border-line")}>
                  <div className="flex items-start gap-3">
                    {canEdit && !added && (
                      <input
                        type="checkbox"
                        className="mt-1 size-4 shrink-0 accent-forest"
                        checked={selected.has(s.suggestionId)}
                        aria-label={`Selecionar “${s.title}”`}
                        onChange={(e) =>
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(s.suggestionId);
                            else next.delete(s.suggestionId);
                            return next;
                          })
                        }
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <ActivityLine a={s} />
                      <p className="mt-2 text-sm text-ink-soft">{s.reason}</p>
                      {s.notes && <p className="mt-1 text-sm text-ink">{s.notes}</p>}
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-soft">
                        {s.verification.status === "UNVERIFIED" && <Unverified note={s.verification.note} />}
                        {cost && <span>{cost}</span>}
                        {added && (
                          <span className="inline-flex items-center gap-1 font-semibold text-forest">
                            <Check aria-hidden className="size-3.5" /> No roteiro
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {limitHit && renderLimit()}
      {canEdit && (
        <div className="sticky bottom-0 -mx-5 border-t border-line bg-cream px-5 pb-1 pt-3 sm:-mx-6 sm:px-6">
          <Button className="w-full" disabled={busy || pending.length === 0} onClick={() => void add()}>
            {busy ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : <Plus aria-hidden className="size-4" />}
            {busy
              ? "Adicionando…"
              : pending.length === 0
                ? "Selecione sugestões para adicionar"
                : pending.length === 1
                  ? "Adicionar a selecionada"
                  : `Adicionar ${pending.length} selecionadas`}
          </Button>
        </div>
      )}
    </div>
  );
}

/* ───────────────────────────── Ajustes ───────────────────────────── */

type Outcome = "ok" | "conflict" | "error";

const typeMeta = {
  add: { label: "Adicionar", icon: Plus, tone: "bg-forest-100 text-forest" },
  update: { label: "Alterar", icon: Pencil, tone: "bg-[#E4ECF6] text-[#294C78]" },
  remove: { label: "Remover", icon: Minus, tone: "bg-[#fbe4df] text-[#9b2c1a]" },
} as const;

export function AdjustmentsReview({ job, trip, onApplied }: { job: AiJobDto; trip: Trip; onApplied: () => Promise<unknown> }) {
  const toast = useToast();
  const changes = job.result?.changes ?? [];
  const done = appliedFor(job.id);
  const all = trip.days.flatMap((d) => d.activities);
  const target = (c: ProposedChangeDto) => (c.activityId ? all.find((a) => a.id === c.activityId) : undefined);
  /** A atividade mudou (ou sumiu) desde que a IA propôs o ajuste */
  const stale = (c: ProposedChangeDto) => c.type !== "add" && (!target(c) || target(c)!.version !== c.baseVersion);

  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(changes.filter((c) => !done.has(c.changeId) && !stale(c)).map((c) => c.changeId)),
  );
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Record<string, Outcome>>({});
  const lock = useRef(false);
  const canEdit = trip.role !== "VIEWER";

  const chosen = changes.filter((c) => selected.has(c.changeId) && !done.has(c.changeId));
  const destructive = chosen.filter((c) => c.type !== "add");

  async function apply() {
    if (lock.current || chosen.length === 0) return;
    lock.current = true;
    setBusy(true);
    const out: Record<string, Outcome> = {};
    // Adições em um único lote atômico
    const adds = chosen.filter((c) => c.type === "add");
    if (adds.length) {
      try {
        await itineraryApi.batchCreate(trip.id, adds.map((c) => ({ dayId: c.dayId, ...toActivityInput(fromProposed(c.activity)) })));
        adds.forEach((c) => (out[c.changeId] = "ok"));
      } catch {
        adds.forEach((c) => (out[c.changeId] = "error"));
      }
    }
    // Alterações e remoções com a versão que a IA viu: se a atividade mudou, o servidor recusa
    for (const c of destructive) {
      if (!c.activityId || c.baseVersion === null) {
        out[c.changeId] = "error";
        continue;
      }
      try {
        if (c.type === "update") {
          await itineraryApi.updateActivity(trip.id, c.activityId, {
            // Sem campos do lugar: mantém o ponto no mapa se a IA não mudou o local
            ...toActivityInput(fromProposed(c.activity), { place: false }),
            version: c.baseVersion,
            ...(target(c) && target(c)!.dayId !== c.dayId ? { dayId: c.dayId } : {}),
          });
        } else {
          await itineraryApi.deleteActivity(trip.id, c.activityId, c.baseVersion);
        }
        out[c.changeId] = "ok";
      } catch (e) {
        out[c.changeId] = isApiError(e, "VERSION_CONFLICT") || isApiError(e, "ACTIVITY_NOT_FOUND") ? "conflict" : "error";
        if (!isApiError(e)) toast.show(errorMessage(e), { tone: "error" });
      }
    }
    Object.entries(out).forEach(([id, r]) => r === "ok" && done.add(id));
    setResults((prev) => ({ ...prev, ...out }));
    setSelected(new Set());
    setConfirming(false);
    await onApplied();
    const ok = Object.values(out).filter((r) => r === "ok").length;
    const failed = Object.values(out).length - ok;
    toast.show(
      failed === 0 ? `${plural(ok, "ajuste aplicado", "ajustes aplicados")}` : `${ok} de ${ok + failed} ajustes aplicados; veja os que ficaram de fora`,
      { tone: failed === 0 ? "success" : "info" },
    );
    lock.current = false;
    setBusy(false);
  }

  if (changes.length === 0) {
    return (
      <div className="space-y-3 rounded-2xl border border-dashed border-line bg-white/70 p-5 text-center">
        <p className="font-display text-lg font-bold text-forest">Nenhum ajuste proposto</p>
        <JobNotes job={job} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <JobNotes job={job} />
      <p className="flex items-start gap-2 rounded-xl bg-cream-200/70 px-3 py-2 text-xs text-ink-soft">
        <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        Nada muda sem sua confirmação. Locais, preços e horários sugeridos não foram verificados.
      </p>
      <ul className="space-y-2">
        {changes.map((c) => {
          const meta = typeMeta[c.type];
          const Icon = meta.icon;
          const current = target(c);
          const isStale = stale(c);
          const result = results[c.changeId] ?? (done.has(c.changeId) ? "ok" : undefined);
          return (
            <li key={c.changeId} className="rounded-2xl border border-line bg-white p-3.5">
              <div className="flex items-start gap-3">
                {canEdit && !result && (
                  <input
                    type="checkbox"
                    className="mt-1 size-4 shrink-0 accent-forest"
                    checked={selected.has(c.changeId)}
                    aria-label={`Selecionar: ${meta.label} “${c.activity.title}”`}
                    onChange={(e) =>
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(c.changeId);
                        else next.delete(c.changeId);
                        return next;
                      })
                    }
                  />
                )}
                <div className="min-w-0 flex-1 space-y-2">
                  <p className="flex flex-wrap items-center gap-2 text-xs">
                    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-bold", meta.tone)}>
                      <Icon aria-hidden className="size-3" /> {meta.label}
                    </span>
                    <span className="text-ink-soft">{longDateTitle(c.date)}</span>
                    {c.verification.status === "UNVERIFIED" && c.type !== "remove" && <Unverified note={c.verification.note} />}
                  </p>
                  {c.type === "update" && current ? (
                    <div className="grid min-w-0 gap-1.5">
                      <div className="min-w-0 rounded-xl bg-cream/70 p-2 opacity-80">
                        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">Hoje</p>
                        <ActivityLine a={{ ...current, durationMinutes: current.durationMin }} />
                      </div>
                      <ArrowRight aria-hidden className="mx-auto size-4 rotate-90 text-ink-soft" />
                      <div className="min-w-0 rounded-xl bg-forest-100/50 p-2">
                        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-forest">Proposto</p>
                        <ActivityLine a={c.activity} />
                      </div>
                    </div>
                  ) : c.type === "remove" && current ? (
                    <div className="line-through decoration-[#9b2c1a]/60">
                      <ActivityLine a={{ ...current, durationMinutes: current.durationMin }} />
                    </div>
                  ) : (
                    <ActivityLine a={c.activity} />
                  )}
                  <p className="text-sm text-ink-soft">{c.reason}</p>
                  {isStale && !result && (
                    <p className="flex items-start gap-1.5 text-xs font-medium text-[#7a5200]">
                      <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
                      Esta atividade mudou ou foi excluída depois da sugestão. Aplicar pode ser recusado.
                    </p>
                  )}
                  {result === "ok" && (
                    <p className="flex items-center gap-1 text-xs font-semibold text-forest">
                      <Check aria-hidden className="size-3.5" /> Aplicado
                    </p>
                  )}
                  {result === "conflict" && (
                    <p className="text-xs font-semibold text-[#7a5200]">Não aplicado: a atividade mudou desde a sugestão.</p>
                  )}
                  {result === "error" && <p className="text-xs font-semibold text-[#9b2c1a]">Não aplicado: tente de novo mais tarde.</p>}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {canEdit && (
        <div className="sticky bottom-0 -mx-5 border-t border-line bg-cream px-5 pb-1 pt-3 sm:-mx-6 sm:px-6">
          {confirming ? (
            <div role="alert" className="space-y-2">
              <p className="text-sm text-[#7a2a1a]">
                Confirma? {destructive.filter((c) => c.type === "update").length > 0 &&
                  `${plural(destructive.filter((c) => c.type === "update").length, "atividade será alterada", "atividades serão alteradas")}. `}
                {destructive.filter((c) => c.type === "remove").length > 0 &&
                  `${plural(destructive.filter((c) => c.type === "remove").length, "atividade será removida", "atividades serão removidas")}. `}
                {chosen.length - destructive.length > 0 && `${plural(chosen.length - destructive.length, "nova atividade", "novas atividades")}.`}
              </p>
              <div className="flex gap-2">
                <Button variant="ghost" className="flex-1" onClick={() => setConfirming(false)} disabled={busy}>
                  Revisar de novo
                </Button>
                <Button variant="danger" className="flex-1" onClick={() => void apply()} disabled={busy}>
                  {busy && <LoaderCircle aria-hidden className="size-4 animate-spin" />}
                  Aplicar
                </Button>
              </div>
            </div>
          ) : (
            <Button
              className="w-full"
              disabled={busy || chosen.length === 0}
              onClick={() => (destructive.length > 0 ? setConfirming(true) : void apply())}
            >
              {busy && <LoaderCircle aria-hidden className="size-4 animate-spin" />}
              {chosen.length === 0 ? "Selecione ajustes para aplicar" : `Aplicar ${plural(chosen.length, "ajuste", "ajustes")}`}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
