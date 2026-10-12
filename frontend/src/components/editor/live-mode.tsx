"use client";

import { ArrowRight, CalendarClock, Clock, Coffee, ExternalLink, FlaskConical, MapPin, Moon, Sunrise } from "lucide-react";
import { endTime } from "@/lib/activities";
import { formatDuration, fromMinutes, toMinutes } from "@/lib/dates";
import { mapsSearchUrl, type LiveInfo } from "@/lib/live";
import type { ActivityContent as Activity } from "@/lib/types";
import { cn } from "@/lib/utils";

export type TripPhase = "before" | "during" | "after" | "unknown";

interface LiveModeProps {
  destination: string;
  dayLabel: string | null;
  info: LiveInfo | null;
  minutes: number | null;
  offset: string;
  phase: TripPhase;
  daysToStart: number | null;
  simulated: boolean;
  onSimulatedChange: (on: boolean) => void;
  simMinutes: number;
  onSimMinutesChange: (m: number) => void;
  onFocus: (id: string) => void;
}

const presets = [
  ["Manhã", 9 * 60 + 30],
  ["Almoço", 13 * 60 + 45],
  ["Fim de tarde", 17 * 60 + 20],
  ["Noite", 20 * 60 + 30],
] as const;

export function LiveMode(props: LiveModeProps) {
  const { info, minutes, dayLabel, phase, simulated } = props;
  const outsideTrip = !simulated && phase !== "during";

  return (
    <section aria-labelledby="titulo-ao-vivo" className="on-dark rounded-3xl bg-forest p-4 text-cream sm:p-5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id="titulo-ao-vivo" className="font-display text-lg font-bold">
          Durante a viagem
        </h2>
        {dayLabel && minutes !== null && !outsideTrip && (
          <p className="text-sm text-cream/80">
            {dayLabel} · <span className="font-semibold tabular-nums text-cream">{fromMinutes(minutes)}</span>{" "}
            <span className="text-cream/60">({props.offset})</span>
          </p>
        )}
        {simulated && (
          <span className="rounded-full bg-[#fbf2df] px-2 py-0.5 text-[11px] font-bold text-[#5c430c]">Horário simulado</span>
        )}
      </div>

      <div aria-live="polite" className="mt-3">
        {outsideTrip ? (
          <OutsideTrip phase={phase} daysToStart={props.daysToStart} />
        ) : info && minutes !== null ? (
          <StatusCards info={info} minutes={minutes} destination={props.destination} onFocus={props.onFocus} />
        ) : null}
      </div>

      {/* Simulação: área secundária, só para conferir outros horários */}
      <details className="group mt-4 rounded-2xl bg-white/6 px-4 py-3" open={simulated || undefined}>
        <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-cream/90 [&::-webkit-details-marker]:hidden">
          <FlaskConical aria-hidden className="size-4" />
          Simular horário <span className="font-normal text-cream/60">(prévia, não muda o roteiro)</span>
          <span aria-hidden className="ml-auto text-cream/60 transition group-open:rotate-90">›</span>
        </summary>
        <div className="mt-3 space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={simulated}
              onChange={(e) => props.onSimulatedChange(e.target.checked)}
              className="size-4 accent-coral"
            />
            Usar horário simulado no dia selecionado
          </label>
          {simulated && (
            <>
              <div className="flex items-center gap-3">
                <label htmlFor="hora-simulada" className="text-sm text-cream/80">
                  Horário
                </label>
                <input
                  id="hora-simulada"
                  type="range"
                  min={6 * 60}
                  max={23 * 60 + 45}
                  step={15}
                  value={props.simMinutes}
                  onChange={(e) => props.onSimMinutesChange(Number(e.target.value))}
                  aria-valuetext={fromMinutes(props.simMinutes)}
                  className="min-w-0 flex-1 accent-coral"
                />
                <output htmlFor="hora-simulada" className="w-12 text-right font-display font-bold tabular-nums text-coral">
                  {fromMinutes(props.simMinutes)}
                </output>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {presets.map(([label, m]) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => props.onSimMinutesChange(m)}
                    aria-pressed={props.simMinutes === m}
                    className="min-h-9 rounded-full bg-white/10 px-3 text-xs font-medium text-cream hover:bg-white/20 aria-pressed:bg-coral aria-pressed:text-ink"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </>
          )}
          <p className="text-xs text-cream/60">
            Sem a simulação, o modo usa a data e a hora atuais no fuso do destino.
          </p>
        </div>
      </details>
    </section>
  );
}

function OutsideTrip({ phase, daysToStart }: { phase: TripPhase; daysToStart: number | null }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl bg-cream p-4 text-ink">
      <CalendarClock aria-hidden className="mt-0.5 size-5 shrink-0 text-forest" />
      <div>
        <p className="font-display text-lg font-bold text-forest">
          {phase === "before"
            ? daysToStart === 1
              ? "A viagem começa amanhã"
              : `A viagem começa em ${daysToStart} dias`
            : phase === "after"
              ? "Essa viagem já terminou"
              : "Carregando o horário…"}
        </p>
        <p className="mt-0.5 text-sm text-ink-soft">
          Durante os dias da viagem, este painel mostra o que está acontecendo agora e o próximo compromisso. Para ver
          como funciona, use a simulação abaixo.
        </p>
      </div>
    </div>
  );
}

function StatusCards({
  info,
  minutes,
  destination,
  onFocus,
}: {
  info: LiveInfo;
  minutes: number;
  destination: string;
  onFocus: (id: string) => void;
}) {
  const s = info.status;
  const next = s.kind === "before" || s.kind === "free" ? s.next : s.kind === "in-progress" ? s.next : null;

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-2xl bg-cream p-4 text-ink">
        {s.kind === "empty" && (
          <Headline icon={Coffee} label="Dia livre" title="Nada programado para este dia." />
        )}
        {s.kind === "before" && (
          <Headline
            icon={Sunrise}
            label="Antes da programação"
            title={`Seu dia começa às ${s.next.time}`}
            detail={`em ${formatDuration(toMinutes(s.next.time) - minutes)}`}
          />
        )}
        {s.kind === "free" && (
          <Headline
            icon={Coffee}
            label="Tempo livre"
            title="Nenhuma atividade em andamento"
            detail={
              s.previous.durationMin
                ? `“${s.previous.title}” terminou às ${endTime(s.previous)}`
                : `Último compromisso: “${s.previous.title}” às ${s.previous.time}`
            }
          />
        )}
        {s.kind === "ended" && (
          <Headline
            icon={Moon}
            label="Programação encerrada"
            title="Nada mais programado para hoje"
            detail={`A última atividade foi “${s.previous.title}” às ${s.previous.time}.`}
          />
        )}
        {s.kind === "in-progress" && (
          <>
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-coral-700">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-coral opacity-75" />
                <span className="relative inline-flex size-2 rounded-full bg-coral" />
              </span>
              Agora
            </p>
            <ActivityDetails
              activity={s.current}
              destination={destination}
              onFocus={onFocus}
              when={`${s.current.time}–${endTime(s.current)} · termina em ${formatDuration(
                toMinutes(s.current.time) + s.current.durationMin! - minutes,
              )}`}
              tone="light"
            />
            <div
              className="mt-3 h-1.5 overflow-hidden rounded-full bg-sand"
              role="progressbar"
              aria-label="Andamento da atividade"
              aria-valuenow={Math.round(s.progress * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div className="h-full rounded-full bg-coral" style={{ width: `${Math.round(s.progress * 100)}%` }} />
            </div>
          </>
        )}
      </div>

      <div className="rounded-2xl bg-white/8 p-4">
        <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-cream/75">
          <ArrowRight aria-hidden className="size-3.5" /> A seguir
        </p>
        {next ? (
          <ActivityDetails
            activity={next}
            destination={destination}
            onFocus={onFocus}
            when={`às ${next.time} · em ${formatDuration(toMinutes(next.time) - minutes)}`}
            tone="dark"
          />
        ) : (
          <p className="mt-1 text-sm text-cream/80">
            {s.kind === "empty" ? "Adicione atividades para acompanhar o dia." : "Nada mais programado para hoje."}
          </p>
        )}
      </div>
    </div>
  );
}

function Headline({
  icon: Icon,
  label,
  title,
  detail,
}: {
  icon: typeof Coffee;
  label: string;
  title: string;
  detail?: string;
}) {
  return (
    <>
      <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-forest-600">
        <Icon aria-hidden className="size-3.5" /> {label}
      </p>
      <p className="mt-1 font-display text-lg font-bold leading-snug text-forest">{title}</p>
      {detail && <p className="mt-0.5 text-sm text-ink-soft">{detail}</p>}
    </>
  );
}

function ActivityDetails({
  activity: a,
  destination,
  when,
  tone,
  onFocus,
}: {
  activity: Activity;
  destination: string;
  when: string;
  tone: "light" | "dark";
  onFocus: (id: string) => void;
}) {
  const muted = tone === "light" ? "text-ink-soft" : "text-cream/75";
  return (
    <>
      <button
        type="button"
        onClick={() => onFocus(a.id)}
        className={cn(
          "mt-1 text-left font-display text-lg font-bold leading-snug wrap-anywhere hover:underline",
          tone === "light" ? "text-forest" : "text-cream",
        )}
      >
        {a.title}
      </button>
      <p className={cn("mt-0.5 flex items-center gap-1 text-sm", muted)}>
        <Clock aria-hidden className="size-3.5 shrink-0" /> {when}
      </p>
      {a.location && (
        <p className={cn("mt-0.5 flex items-start gap-1 text-sm", muted)}>
          <MapPin aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <span className="wrap-anywhere">{a.location}</span>
        </p>
      )}
      {a.notes && (
        <p className={cn("mt-2 rounded-lg px-2.5 py-1.5 text-sm wrap-anywhere", tone === "light" ? "bg-sand/60" : "bg-white/10")}>
          {a.notes}
        </p>
      )}
      {a.location && (
        <a
          href={mapsSearchUrl(a.location, destination)}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            "mt-2 inline-flex min-h-10 items-center gap-1.5 rounded-full px-3 text-sm font-semibold transition",
            tone === "light" ? "bg-forest text-cream hover:bg-forest-700" : "bg-cream text-forest hover:bg-white",
          )}
        >
          <ExternalLink aria-hidden className="size-4" />
          Abrir no Google Maps
          <span className="sr-only"> (abre em nova aba)</span>
        </a>
      )}
    </>
  );
}
