"use client";

import { GitCompareArrows, LoaderCircle, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { errorMessage, isApiError } from "@/api/client";
import type { ActivityDto } from "@/api/contracts";
import { toActivity } from "@/api/mappers";
import { PlaceAutocomplete, PlaceStatus, tripLocalPlaces } from "@/components/location/place-autocomplete";
import { Button } from "@/components/ui/button";
import { Field, inputClasses } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { categories, categoryOrder } from "@/lib/categories";
import { MAX_ACTIVITIES_PER_DAY } from "@/lib/limits";
import { endTime, findOverlap } from "@/lib/activities";
import { formatDuration, longDate } from "@/lib/dates";
import type { Activity, ActivityContent, ActivityPlace, Category, TripDay } from "@/lib/types";
import { cn } from "@/lib/utils";

const durations = [15, 30, 45, 60, 75, 90, 120, 150, 180, 240, 300];

export type ActivityDraft = Omit<ActivityContent, "id"> & { dayId: string };

interface ActivityModalProps {
  open: boolean;
  tripId: string;
  /** Aberto por "Definir no mapa": foca o local e já busca sugestões para o texto atual */
  focusLocation?: boolean;
  initial?: Activity | null;
  /** Dia sugerido para uma nova atividade */
  dayId: string;
  days: TripDay[];
  onClose: () => void;
  /**
   * Salva no servidor. `version` é a versão sobre a qual o rascunho será aplicado.
   * Erros da API são tratados aqui, preservando o que a pessoa digitou.
   */
  onSubmit: (draft: ActivityDraft, version?: number) => Promise<void>;
  /** Recarrega o roteiro (após conflito ou mudança de permissão) */
  onStale: () => void;
  limitPerDay: number | null;
}

export function ActivityModal(props: ActivityModalProps) {
  const { open, initial, onClose } = props;
  return (
    <Modal open={open} onClose={onClose} title={initial ? "Editar atividade" : "Nova atividade"} size="lg">
      <ActivityForm key={`${initial?.id ?? `nova-${props.dayId}`}${props.focusLocation ? "-local" : ""}`} {...props} />
    </Modal>
  );
}

type Problem =
  | { kind: "limit"; limit: number }
  | { kind: "conflict"; current: Activity }
  | { kind: "deleted" }
  | { kind: "error"; message: string };

function ActivityForm({
  initial,
  tripId,
  focusLocation,
  dayId: suggestedDay,
  days,
  onClose,
  onSubmit,
  onStale,
  limitPerDay,
}: ActivityModalProps) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [time, setTime] = useState(initial?.time ?? "");
  const [category, setCategory] = useState<Category>(initial?.category ?? "passeio");
  const [location, setLocation] = useState(initial?.location ?? "");
  /** Lugar escolhido nas sugestões; some quando o texto do local muda */
  const [place, setPlace] = useState<ActivityPlace | undefined>(initial?.place);
  const [duration, setDuration] = useState<string>(initial?.durationMin ? String(initial.durationMin) : "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [dayId, setDayId] = useState(initial?.dayId ?? suggestedDay);
  const [errors, setErrors] = useState<{ title?: string; time?: string }>({});
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  /** Versão sobre a qual o rascunho será salvo (muda ao revisar um conflito) */
  const [baseVersion, setBaseVersion] = useState(initial?.version);

  const day = days.find((d) => d.id === dayId) ?? days[0];
  // Lugares já escolhidos em outras atividades da viagem (sugestões sem custo de API)
  const localPlaces = useMemo(
    () => tripLocalPlaces(days.flatMap((d) => d.activities).filter((a) => a.id !== initial?.id)),
    [days, initial?.id],
  );
  const others = day.activities.filter((a) => a.id !== initial?.id);
  const validTime = /^\d{2}:\d{2}$/.test(time);
  const overlap = validTime
    ? findOverlap({ id: initial?.id ?? "__nova", time, durationMin: duration ? Number(duration) : undefined }, others)
    : null;
  const movingDay = !!initial && dayId !== initial.dayId;
  const dayFull = (!initial || movingDay) && !day.canAddActivities;

  const limitNotice = problem?.kind === "limit" ? problem.limit : dayFull ? (limitPerDay ?? MAX_ACTIVITIES_PER_DAY) : null;

  const draft = (): ActivityDraft => ({
    dayId,
    title: title.trim(),
    time,
    category,
    location: location.trim() || undefined,
    durationMin: duration ? Number(duration) : undefined,
    notes: notes.trim() || undefined,
    place,
  });

  async function save(version = baseVersion) {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      await onSubmit(draft(), version);
    } catch (e) {
      setBusy(false);
      if (isApiError(e, "DAILY_ACTIVITY_LIMIT_REACHED")) {
        setProblem({ kind: "limit", limit: Number(e.details.limit ?? limitPerDay ?? MAX_ACTIVITIES_PER_DAY) });
        onStale();
      } else if (isApiError(e, "VERSION_CONFLICT") && e.details.current) {
        setProblem({ kind: "conflict", current: toActivity(e.details.current as ActivityDto) });
        onStale();
      } else if (isApiError(e, "ACTIVITY_NOT_FOUND")) {
        setProblem({ kind: "deleted" });
        onStale();
      } else if (isApiError(e, "DAY_NOT_FOUND")) {
        setProblem({ kind: "error", message: "Este dia não existe mais na viagem (as datas mudaram). Escolha outro dia." });
        onStale();
      } else if (isApiError(e, "FORBIDDEN") || isApiError(e, "TRIP_NOT_FOUND")) {
        setProblem({ kind: "error", message: `${e.message} Seu rascunho continua aqui.` });
        onStale();
      } else {
        setProblem({ kind: "error", message: `${errorMessage(e)} Seu rascunho continua aqui.` });
      }
    }
  }

  function submit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const form = ev.currentTarget;
    const e: typeof errors = {};
    if (!title.trim()) e.title = "Dê um título para a atividade.";
    if (!validTime) e.time = "Informe o horário.";
    setErrors(e);
    if (e.title || e.time) {
      window.setTimeout(() => form.querySelector<HTMLElement>("[aria-invalid=true]")?.focus());
      return;
    }
    void save();
  }

  function applyServerVersion(current: Activity) {
    setTitle(current.title);
    setTime(current.time);
    setCategory(current.category);
    setLocation(current.location ?? "");
    setPlace(current.place);
    setDuration(current.durationMin ? String(current.durationMin) : "");
    setNotes(current.notes ?? "");
    setDayId(current.dayId);
    setBaseVersion(current.version);
    setProblem(null);
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4" aria-busy={busy}>
      {problem?.kind === "conflict" && (
        <ConflictNotice
          draft={draft()}
          current={problem.current}
          days={days}
          busy={busy}
          onKeepDraft={() => {
            setBaseVersion(problem.current.version);
            void save(problem.current.version);
          }}
          onUseCurrent={() => applyServerVersion(problem.current)}
        />
      )}
      {problem?.kind === "deleted" && (
        <div role="alert" className="rounded-2xl bg-[#fbf2df] p-4 text-sm text-[#5c430c]">
          <p className="flex items-center gap-2 font-semibold">
            <TriangleAlert aria-hidden className="size-4" /> Esta atividade foi excluída por outra pessoa
          </p>
          <p className="mt-1">Seu rascunho continua abaixo. Você pode criá-la de novo ou descartar.</p>
        </div>
      )}
      {limitNotice !== null && (
        <p
          role={problem?.kind === "limit" ? "alert" : "status"}
          className="flex items-start gap-2 rounded-2xl bg-[#fbf2df] px-3.5 py-3 text-sm text-[#5c430c]"
        >
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>
            Este dia já tem {limitNotice} atividades, o máximo por dia. Escolha outro dia ou remova uma atividade dele
            {problem?.kind === "limit" ? ". Seu rascunho continua aqui." : "."}
          </span>
        </p>
      )}
      {problem?.kind === "error" && (
        <p role="alert" className="flex items-start gap-2 rounded-2xl bg-[#fbe4df] px-3.5 py-3 text-sm text-[#7a2a1a]">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {problem.message}
        </p>
      )}

      <div className="grid grid-cols-[1fr_128px] gap-3">
        <Field label="Título" required error={errors.title}>
          {(p) => (
            <input
              {...p}
              data-autofocus={focusLocation ? undefined : true}
              className={inputClasses}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex.: Pôr do sol no Arpoador"
              maxLength={200}
            />
          )}
        </Field>
        <Field label="Horário" required error={errors.time} hint="Define a posição no dia">
          {(p) => (
            <input {...p} type="time" className={inputClasses} value={time} onChange={(e) => setTime(e.target.value)} />
          )}
        </Field>
      </div>

      <Field label="Dia" required hint={movingDay ? "A atividade vai para o fim do mesmo horário no novo dia." : undefined}>
        {(p) => (
          <select {...p} className={inputClasses} value={dayId} onChange={(e) => setDayId(e.target.value)}>
            {days.map((d, i) => (
              <option key={d.id} value={d.id}>
                Dia {i + 1} · {longDate(d.date)}
              </option>
            ))}
          </select>
        )}
      </Field>

      <fieldset>
        <legend className="text-sm font-semibold text-ink">
          Categoria <span className="font-normal text-ink-soft">(opcional)</span>
        </legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {categoryOrder.map((c) => {
            const meta = categories[c];
            const Icon = meta.icon;
            const checked = category === c;
            return (
              <label
                key={c}
                className={cn(
                  "inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-forest",
                  checked ? "border-forest bg-forest text-cream" : "border-line bg-white text-ink hover:border-forest/40",
                )}
              >
                <input
                  type="radio"
                  name="categoria"
                  value={c}
                  checked={checked}
                  onChange={() => setCategory(c)}
                  className="sr-only"
                />
                <Icon aria-hidden className="size-4" />
                {meta.label}
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-[1fr_160px] sm:items-start">
        <Field label="Local">
          {(p) => (
            <div className="flex flex-col gap-1.5">
              <PlaceAutocomplete
                tripId={tripId}
                kind="place"
                fieldProps={p}
                text={location}
                onTextChange={(value) => {
                  setLocation(value);
                  // Texto diferente do lugar escolhido: as coordenadas antigas não valem mais
                  if (place && value.trim() !== location.trim()) setPlace(undefined);
                }}
                onSelect={(choice) => {
                  setLocation(choice.name);
                  setPlace(choice.place);
                }}
                localPlaces={localPlaces}
                placeholder="Ex.: Marco Zero, Recife"
                searchOnMount={focusLocation}
                initialFocus={focusLocation}
              />
              <PlaceStatus
                address={place ? (place.formattedAddress ?? "local selecionado") : null}
                hasText={location.trim().length > 0}
                onClear={() => setPlace(undefined)}
              />
            </div>
          )}
        </Field>
        <Field label="Duração">
          {(p) => (
            <select {...p} className={inputClasses} value={duration} onChange={(e) => setDuration(e.target.value)}>
              <option value="">Sem duração</option>
              {duration && !durations.includes(Number(duration)) && (
                <option value={duration}>{formatDuration(Number(duration))}</option>
              )}
              {durations.map((d) => (
                <option key={d} value={d}>
                  {formatDuration(d)}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>

      {overlap && (
        <p role="status" className="flex items-start gap-2 rounded-xl bg-[#fbf2df] px-3 py-2 text-sm text-[#5c430c]">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>
            Esse horário se sobrepõe a “{overlap.title}” ({overlap.time}
            {overlap.durationMin ? `–${endTime(overlap)}` : ""}). Você pode salvar mesmo assim.
          </span>
        </p>
      )}

      <Field label="Observações">
        {(p) => (
          <textarea
            {...p}
            rows={3}
            className={cn(inputClasses, "resize-none")}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Ex.: levar protetor solar"
            maxLength={5000}
          />
        )}
      </Field>


      <div className="flex flex-wrap justify-end gap-2 pt-1">
        <Button variant="ghost" onClick={onClose}>
          {problem ? "Descartar rascunho" : "Cancelar"}
        </Button>
        {problem?.kind === "deleted" ? (
          <Button type="button" disabled={busy} onClick={() => void save(undefined)}>
            {busy && <LoaderCircle aria-hidden className="size-4 animate-spin" />}
            Criar de novo com meu rascunho
          </Button>
        ) : (
          problem?.kind !== "conflict" && (
            <Button type="submit" disabled={busy}>
              {busy && <LoaderCircle aria-hidden className="size-4 animate-spin" />}
              {busy ? "Salvando…" : initial ? "Salvar alterações" : "Adicionar ao dia"}
            </Button>
          )
        )}
      </div>
    </form>
  );
}

const fieldLabels: [keyof ActivityDraft, string][] = [
  ["title", "Título"],
  ["time", "Horário"],
  ["dayId", "Dia"],
  ["category", "Categoria"],
  ["location", "Local"],
  ["place", "Ponto no mapa"],
  ["durationMin", "Duração"],
  ["notes", "Observações"],
];

/** Mostra o que mudou no servidor e deixa a pessoa decidir; nada é sobrescrito sem confirmação. */
function ConflictNotice({
  draft,
  current,
  days,
  busy,
  onKeepDraft,
  onUseCurrent,
}: {
  draft: ActivityDraft;
  current: Activity;
  days: TripDay[];
  busy: boolean;
  onKeepDraft: () => void;
  onUseCurrent: () => void;
}) {
  const show = (key: keyof ActivityDraft, value: unknown) => {
    if (value === undefined || value === "") return "—";
    if (key === "dayId") {
      const i = days.findIndex((d) => d.id === value);
      return i >= 0 ? `Dia ${i + 1}` : "outro dia";
    }
    if (key === "category") return categories[value as Category].label;
    if (key === "durationMin") return formatDuration(value as number);
    if (key === "place") return (value as ActivityPlace).formattedAddress ?? "definido";
    return String(value);
  };
  const diffs = fieldLabels.filter(([k]) => show(k, draft[k]) !== show(k, current[k as keyof Activity]));

  return (
    <div role="alert" className="rounded-2xl border border-[#e8c98a] bg-[#fbf2df] p-4 text-sm text-[#5c430c]">
      <p className="flex items-center gap-2 font-semibold">
        <GitCompareArrows aria-hidden className="size-4" /> O roteiro mudou enquanto você editava
      </p>
      <p className="mt-1">
        Outra pessoa salvou esta atividade. Nada foi sobrescrito: compare e escolha qual versão manter.
      </p>
      {diffs.length > 0 ? (
        <dl className="mt-3 grid grid-cols-[auto_1fr_1fr] gap-x-3 gap-y-1 text-xs">
          <span />
          <span className="font-semibold">Seu rascunho</span>
          <span className="font-semibold">Versão atual</span>
          {diffs.map(([k, label]) => (
            <div key={k} className="contents">
              <dt className="font-semibold">{label}</dt>
              <dd className="wrap-anywhere">{show(k, draft[k])}</dd>
              <dd className="wrap-anywhere">{show(k, current[k as keyof Activity])}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-2 text-xs">Os campos ficaram iguais aos seus.</p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" disabled={busy} onClick={onKeepDraft}>
          {busy && <LoaderCircle aria-hidden className="size-4 animate-spin" />}
          Salvar meu rascunho
        </Button>
        <Button size="sm" variant="secondary" disabled={busy} onClick={onUseCurrent}>
          Usar a versão atual
        </Button>
      </div>
    </div>
  );
}
