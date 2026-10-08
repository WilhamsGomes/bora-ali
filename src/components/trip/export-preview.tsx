/* eslint-disable @next/next/no-img-element -- imagens same-origin simples facilitam a geração do PNG */
import { forwardRef } from "react";
import { endTime } from "@/lib/activities";
import { categories } from "@/lib/categories";
import { formatDuration, longDateTitle } from "@/lib/dates";
import type { DayContent } from "@/lib/types";
import { cn } from "@/lib/utils";

export type ExportStyle = "minimalista" | "diario" | "colorido";

export const exportStyles: { id: ExportStyle; label: string; description: string }[] = [
  { id: "minimalista", label: "Minimalista", description: "Branco, limpo e direto ao ponto" },
  { id: "diario", label: "Diário de viagem", description: "Papel, foto polaroide e letra à mão" },
  { id: "colorido", label: "Colorido", description: "Cores fortes para os stories" },
];

/** URL otimizada pelo próprio Next (mesma origem), útil para gerar PNG sem CORS. */
export function localImage(url: string, width: 640 | 828 | 1080 | 1920 = 828) {
  return `/_next/image?url=${encodeURIComponent(url)}&w=${width}&q=75`;
}

/** Dados mínimos da viagem para a arte. `coverUrl` precisa ser uma foto do Unsplash (servida pelo próprio Next). */
export interface ExportTrip {
  name: string;
  destination: string;
  coverUrl: string;
  isExample?: boolean;
}

interface ExportPreviewProps {
  trip: ExportTrip;
  day: DayContent;
  dayNumber: number;
  variant: ExportStyle;
  className?: string;
}

/**
 * Roteiro diário em formato vertical. A largura é fixa (360px) e a altura
 * mínima é 9:16; com muitas atividades ou textos longos, a altura cresce.
 * A prévia e o arquivo exportado usam exatamente este componente.
 */
export const ExportPreview = forwardRef<HTMLDivElement, ExportPreviewProps>(function ExportPreview(
  { trip, day, dayNumber, variant, className },
  ref,
) {
  const props = { trip, day, dayNumber, compact: day.activities.length > 8 };
  return (
    <div
      ref={ref}
      data-export-root
      className={cn("relative flex min-h-[640px] w-[360px] shrink-0 flex-col overflow-hidden", className)}
    >
      {variant === "minimalista" && <Minimal {...props} />}
      {variant === "diario" && <Journal {...props} />}
      {variant === "colorido" && <Colorful {...props} />}
    </div>
  );
});

interface InnerProps {
  trip: ExportPreviewProps["trip"];
  day: DayContent;
  dayNumber: number;
  /** Dias cheios: espaçamentos menores, mas todo o conteúdo continua visível */
  compact: boolean;
}

function EmptyDay({ className }: { className?: string }) {
  return <p className={cn("py-6 text-center text-sm", className)}>Dia livre — nada planejado ainda.</p>;
}

function timeRange(a: { time: string; durationMin?: number }) {
  const end = endTime(a);
  return end ? `${a.time}–${end}` : a.time;
}

function Minimal({ trip, day, dayNumber, compact }: InnerProps) {
  return (
    <div className="flex flex-1 flex-col bg-white px-8 pb-6 pt-8 text-ink">
      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-ink-soft">
        Dia {dayNumber} · {trip.destination.split(",")[0]}
      </p>
      <h3 className="mt-2 font-display text-[28px] font-bold leading-[1.05] tracking-tight text-forest wrap-anywhere">
        {trip.name}
      </h3>
      <p className="mt-1 text-sm text-ink-soft">{longDateTitle(day.date)}</p>
      <div className="export-keep mt-4 h-20 shrink-0 overflow-hidden rounded-xl">
        <img src={localImage(trip.coverUrl, 640)} alt="" className="size-full object-cover" />
      </div>
      <ol className={cn("mt-5 flex-1", compact ? "space-y-2" : "space-y-3")}>
        {day.activities.length === 0 && <EmptyDay className="text-ink-soft" />}
        {day.activities.map((a) => (
          <li
            key={a.id}
            className="export-keep grid grid-cols-[52px_minmax(0,1fr)] gap-3 border-b border-ink/10 pb-2 last:border-0"
          >
            <span className="pt-px font-mono text-[13px] font-semibold tabular-nums text-forest">{a.time}</span>
            <span className="min-w-0">
              <span className={cn("block font-semibold leading-snug wrap-anywhere", compact ? "text-[14px]" : "text-[15px]")}>
                {a.title}
              </span>
              {(a.location || a.durationMin) && (
                <span className="block text-xs leading-snug text-ink-soft wrap-anywhere">
                  {[a.location, a.durationMin ? formatDuration(a.durationMin) : null].filter(Boolean).join(" · ")}
                </span>
              )}
            </span>
          </li>
        ))}
      </ol>
      <Footer className="mt-4 text-ink-soft" example={trip.isExample} />
    </div>
  );
}

function Journal({ trip, day, dayNumber, compact }: InnerProps) {
  return (
    <div
      className="flex flex-1 flex-col px-7 pb-6 pt-7 text-[#3b3226]"
      style={{
        backgroundColor: "#f6efe2",
        backgroundImage: "repeating-linear-gradient(0deg, transparent 0 27px, rgba(120,95,60,0.13) 27px 28px)",
      }}
    >
      <div className="export-keep flex items-start gap-4">
        <div className="relative w-[124px] shrink-0 -rotate-3 bg-white p-2 pb-1.5 shadow-[0_6px_14px_-6px_rgba(60,40,20,0.45)]">
          <span className="absolute -top-2 left-1/2 h-4 w-12 -translate-x-1/2 rotate-2 bg-[#f4775b]/45" aria-hidden />
          <img src={localImage(trip.coverUrl, 640)} alt="" className="aspect-square w-full object-cover" />
          <span className="mt-1 block text-center font-hand text-base leading-none wrap-anywhere">
            {trip.destination.split(",")[0]}
          </span>
        </div>
        <div className="min-w-0 pt-1">
          <p className="font-hand text-xl leading-none text-[#b5432a]">dia {dayNumber}</p>
          <h3 className="mt-1 font-hand text-[34px] font-bold leading-[0.95] wrap-anywhere">{trip.name}</h3>
          <p className="mt-2 text-xs text-[#6b5c48]">{longDateTitle(day.date)}</p>
        </div>
      </div>
      <ol className={cn("mt-6 flex-1", compact ? "space-y-1.5" : "space-y-2.5")}>
        {day.activities.length === 0 && <EmptyDay className="font-hand text-2xl text-[#6b5c48]" />}
        {day.activities.map((a) => (
          <li key={a.id} className="export-keep grid grid-cols-[48px_minmax(0,1fr)] items-baseline gap-2">
            <span className="font-hand text-xl font-bold tabular-nums text-[#183f36]">{a.time}</span>
            <span className="min-w-0">
              <span className={cn("block font-hand leading-[1.1] wrap-anywhere", compact ? "text-xl" : "text-[23px]")}>
                {a.title}
                {a.durationMin ? (
                  <span className="ml-1.5 text-base text-[#8a7a63]">({formatDuration(a.durationMin)})</span>
                ) : null}
              </span>
              {a.location && <span className="block text-xs leading-snug text-[#6b5c48] wrap-anywhere">{a.location}</span>}
            </span>
          </li>
        ))}
      </ol>
      <Footer className="mt-4 text-[#6b5c48]" example={trip.isExample} />
    </div>
  );
}

function Colorful({ trip, day, dayNumber, compact }: InnerProps) {
  return (
    <div className="flex flex-1 flex-col bg-forest text-cream">
      <div className="export-keep relative h-[200px] shrink-0">
        <img src={localImage(trip.coverUrl, 828)} alt="" className="size-full object-cover" />
        <div className="absolute inset-0 bg-linear-to-b from-transparent via-forest/20 to-forest" />
        <span className="absolute left-6 top-6 rounded-full bg-coral px-3 py-1 text-xs font-bold text-ink">Dia {dayNumber}</span>
        <div className="absolute inset-x-6 bottom-2">
          <h3 className="font-display text-[30px] font-extrabold leading-none tracking-tight wrap-anywhere">{trip.name}</h3>
          <p className="mt-1 text-sm text-cream/80">{longDateTitle(day.date)}</p>
        </div>
      </div>
      <ol className={cn("flex-1 px-6 pt-4", compact ? "space-y-1.5" : "space-y-2")}>
        {day.activities.length === 0 && <EmptyDay className="text-cream/80" />}
        {day.activities.map((a) => {
          const cat = categories[a.category];
          const Icon = cat.icon;
          return (
            <li
              key={a.id}
              className={cn(
                "export-keep grid grid-cols-[32px_minmax(0,1fr)_44px] items-start gap-3 rounded-2xl bg-white/7 px-3",
                compact ? "py-2" : "py-2.5",
              )}
            >
              <span
                className="flex size-8 items-center justify-center rounded-full"
                style={{ backgroundColor: a.category === "alimentacao" ? "#F4775B" : cat.color }}
              >
                <Icon aria-hidden className="size-4 text-white" />
              </span>
              <span className="min-w-0 self-center">
                <span className="block text-sm font-semibold leading-snug wrap-anywhere">{a.title}</span>
                {a.location && <span className="block text-xs leading-snug text-cream/65 wrap-anywhere">{a.location}</span>}
              </span>
              <span className="pt-1.5 text-right font-display text-sm font-bold leading-tight tabular-nums text-coral">
                {a.time}
                {a.durationMin ? (
                  <span className="block text-[10px] font-medium text-cream/60">{timeRange(a).split("–")[1]}</span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ol>
      <Footer className="mt-4 px-6 pb-5 text-cream/70" example={trip.isExample} />
    </div>
  );
}

function Footer({ className, example }: { className?: string; example?: boolean }) {
  return (
    <div className={cn("export-keep flex shrink-0 items-center justify-between text-[10px] font-medium", className)}>
      <span>{example ? "Programação de exemplo · não verificada" : "Meu roteiro"}</span>
      <span className="font-display text-xs font-extrabold tracking-tight">BoraAli</span>
    </div>
  );
}
