import { Clock, MapPin, Sparkles } from "lucide-react";
import Image from "next/image";
import { AvatarStack } from "@/components/ui/avatars";
import { IllustrativeMap } from "./illustrative-map";
import { seedTrips } from "@/data/mock-trips";
import { categories } from "@/lib/categories";
import { dayOfMonth, formatDuration, weekdayShort } from "@/lib/dates";
import { cn } from "@/lib/utils";

const rio = seedTrips[0];
const day = rio.days[1];

/** Prévia estática do editor, usando o roteiro de exemplo do Rio. */
export function ProductPreview() {
  return (
    <div
      className="overflow-hidden rounded-[28px] border border-white/60 bg-white shadow-lift"
      aria-label="Prévia do editor de roteiros com um exemplo de viagem ao Rio de Janeiro"
      role="figure"
    >
      {/* Barra superior estilo app */}
      <div className="flex items-center gap-2 border-b border-line bg-cream-200/60 px-4 py-2.5">
        <span className="size-2.5 rounded-full bg-[#e8a598]" aria-hidden />
        <span className="size-2.5 rounded-full bg-[#ecd08f]" aria-hidden />
        <span className="size-2.5 rounded-full bg-[#9fc7b5]" aria-hidden />
        <span className="ml-3 truncate text-xs font-medium text-ink-soft">boraali · Nosso Rio ❤️ · exemplo ilustrativo</span>
      </div>

      <div className="grid lg:grid-cols-[1.35fr_1fr]">
        <div className="p-4 sm:p-6">
          <div className="relative h-28 overflow-hidden rounded-2xl sm:h-32">
            <Image src={rio.coverUrl} alt={rio.coverAlt} fill sizes="(min-width: 1024px) 640px, 100vw" className="object-cover" />
            <div className="absolute inset-0 bg-linear-to-r from-forest/85 via-forest/40 to-transparent" />
            <div className="absolute inset-y-0 left-0 flex flex-col justify-center px-5 text-cream">
              <p className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">{rio.name}</p>
              <p className="text-sm text-cream/85">16 a 19 de outubro · Botafogo</p>
            </div>
            <AvatarStack people={rio.participants} className="absolute bottom-3 right-3" size="size-7" />
          </div>

          <div className="mt-4 flex gap-2 overflow-hidden" aria-hidden>
            {rio.days.map((d, i) => {
              const active = d.id === day.id;
              return (
                <span
                  key={d.id}
                  className={cn(
                    "flex min-w-[64px] flex-col items-center rounded-2xl border px-3 py-2 text-center",
                    active ? "border-forest bg-forest text-cream" : "border-line bg-white text-ink",
                  )}
                >
                  <span className={cn("text-[11px] font-medium uppercase", active ? "text-cream/80" : "text-ink-soft")}>
                    {weekdayShort(d.date)}
                  </span>
                  <span className="font-display text-lg font-bold leading-tight">{dayOfMonth(d.date)}</span>
                  <span className="sr-only">Dia {i + 1}</span>
                </span>
              );
            })}
          </div>

          <ol className="mt-5 space-y-1">
            {day.activities.map((a, i) => {
              const cat = categories[a.category];
              const Icon = cat.icon;
              return (
                <li key={a.id} className={cn("grid grid-cols-[52px_1fr] gap-3", i > 3 && "hidden sm:grid")}>
                  <span className="pt-3 font-display text-sm font-bold text-forest">{a.time}</span>
                  <div className="flex items-center gap-3 rounded-2xl border border-line/80 bg-cream/60 px-3 py-2.5">
                    <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-xl", cat.chip)}>
                      <Icon aria-hidden className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-ink">{a.title}</p>
                      <p className="flex items-center gap-1 truncate text-xs text-ink-soft">
                        <MapPin aria-hidden className="size-3" /> {a.location}
                        <span aria-hidden>·</span> {formatDuration(a.durationMin)}
                      </p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>

        <div className="hidden flex-col gap-4 border-l border-line bg-cream/50 p-6 lg:flex">
          <IllustrativeMap activities={day.activities} rio className="aspect-[4/3.6]" />
          <div className="rounded-2xl bg-forest p-4 text-cream">
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-coral">
              <Clock aria-hidden className="size-3.5" /> Agora · 17:20
            </p>
            <p className="mt-1 font-display text-lg font-bold">Pôr do sol no Arpoador</p>
            <p className="text-sm text-cream/75">A seguir: Jantar em Copacabana às 20:00</p>
          </div>
          <p className="flex items-start gap-2 rounded-2xl border border-dashed border-coral/60 bg-coral-100/50 p-3 text-xs text-ink">
            <Sparkles aria-hidden className="mt-0.5 size-4 shrink-0 text-coral-700" />
            Sugestão da IA: “Que tal um café sem pressa antes da praia?”
          </p>
        </div>
      </div>
    </div>
  );
}
