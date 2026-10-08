import { CalendarDays, Lock, MapPin, Users } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { coverOf, isUnsplash } from "@/data/photos";
import { dateRange, daysBetween } from "@/lib/dates";
import { plural } from "@/lib/format";
import { planLabels, roleLabels } from "@/lib/plans";
import type { TripSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

export function TripCard({ trip, featured, today }: { trip: TripSummary; featured?: boolean; today: string | null }) {
  const countdown = today ? daysBetween(today, trip.startDate) : null;
  const cover = coverOf(trip);
  const shared = trip.role !== "OWNER";

  const body = (
    <>
      <div className={cn("relative overflow-hidden", featured ? "aspect-[16/10] md:aspect-auto md:w-[58%]" : "aspect-[16/10]")}>
        <Image
          src={cover.url}
          alt={cover.alt}
          fill
          preload={featured}
          unoptimized={!isUnsplash(cover.url)}
          sizes={featured ? "(min-width: 768px) 640px, 100vw" : "(min-width: 768px) 360px, 100vw"}
          className={cn("object-cover transition duration-500", trip.accessible && "group-hover:scale-[1.03]", !trip.accessible && "grayscale")}
        />
        {trip.accessible && countdown !== null && countdown >= 0 && (
          <span className="absolute left-4 top-4 rounded-full bg-cream/95 px-3 py-1 text-xs font-bold text-forest shadow-soft">
            {countdown === 0 ? "É hoje!" : countdown === 1 ? "Falta 1 dia" : `Faltam ${countdown} dias`}
          </span>
        )}
        <span className="absolute right-4 top-4 rounded-full bg-forest/85 px-3 py-1 text-xs font-bold text-cream backdrop-blur">
          {planLabels[trip.plan]}
        </span>
      </div>
      <div className={cn("flex flex-1 flex-col p-5", featured && "md:p-8")}>
        <p className="flex items-center gap-1.5 text-sm font-medium text-ink-soft">
          <MapPin aria-hidden className="size-4 shrink-0 text-coral-700" />
          <span className="wrap-anywhere">{trip.destination}</span>
        </p>
        <h2
          className={cn(
            "mt-1 font-display font-bold tracking-tight text-forest wrap-anywhere",
            featured ? "text-3xl md:text-4xl" : "text-2xl",
          )}
        >
          {trip.name}
        </h2>
        <p className="mt-2 flex items-center gap-1.5 text-sm text-ink">
          <CalendarDays aria-hidden className="size-4 text-ink-soft" />
          {dateRange(trip.startDate, trip.endDate)}
        </p>
        {featured && trip.stay && <p className="mt-1 text-sm text-ink-soft">{trip.stay}</p>}
        {!trip.accessible && (
          <p className="mt-3 flex items-start gap-1.5 rounded-xl bg-[#fbf2df] px-3 py-2 text-xs text-[#5c430c]">
            <Lock aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            Acesso suspenso: o plano desta viagem não inclui mais colaboração. Fale com {trip.ownerName}.
          </p>
        )}
        <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-1 pt-5">
          <span className="flex items-center gap-1.5 text-sm text-ink-soft">
            <Users aria-hidden className="size-4" />
            {shared ? `De ${trip.ownerName} · ${roleLabels[trip.role]}` : "Criada por você"}
          </span>
          <span className="text-xs font-medium text-ink-soft">
            {trip.activityCount === 0 ? "Nada planejado" : plural(trip.activityCount, "atividade", "atividades")}
          </span>
        </div>
      </div>
    </>
  );

  const classes = cn(
    "group relative flex overflow-hidden rounded-[28px] bg-white shadow-soft ring-1 ring-line",
    featured ? "flex-col md:flex-row" : "flex-col",
  );

  if (!trip.accessible) {
    return (
      <article aria-label={`${trip.name} (acesso suspenso)`} className={cn(classes, "opacity-80")}>
        {body}
      </article>
    );
  }
  return (
    <Link href={`/app/viagens/${trip.id}`} className={cn(classes, "transition hover:-translate-y-0.5 hover:shadow-lift")}>
      {body}
    </Link>
  );
}

export function TripCardSkeleton({ featured }: { featured?: boolean }) {
  return (
    <div
      className={cn(
        "animate-pulse overflow-hidden rounded-[28px] bg-white ring-1 ring-line",
        featured ? "h-[420px] md:h-[300px]" : "h-[340px]",
      )}
    >
      <div className="h-1/2 bg-sand/60" />
      <div className="space-y-3 p-5">
        <div className="h-4 w-1/3 rounded bg-sand/70" />
        <div className="h-6 w-2/3 rounded bg-sand/70" />
        <div className="h-4 w-1/2 rounded bg-sand/70" />
      </div>
    </div>
  );
}
