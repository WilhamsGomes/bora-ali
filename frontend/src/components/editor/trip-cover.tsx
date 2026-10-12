import { BedDouble, CalendarDays, Download, MapPin, Pencil, Share2, Users } from "lucide-react";
import Image from "next/image";
import { AvatarStack } from "@/components/ui/avatars";
import { coverOf, isUnsplash } from "@/data/photos";
import { dateRange } from "@/lib/dates";
import { plural } from "@/lib/format";
import type { Participant } from "@/lib/types";

export const participantPalette = ["#F4775B", "#2A5F52", "#7C5CBF", "#C58B1B", "#2B6CB0", "#B5432A"];

interface TripCoverProps {
  trip: { name: string; destination: string; startDate: string; endDate: string; stay?: string; coverUrl: string | null };
  /** Participantes reais (quando disponíveis) */
  people?: { name: string }[];
  onShare?: () => void;
  onPeople?: () => void;
  onExport?: () => void;
  onEdit?: () => void;
}

/** Capa compacta com foto, nome, datas e participantes. */
export function TripCover({ trip, people, onShare, onPeople, onExport, onEdit }: TripCoverProps) {
  const cover = coverOf(trip);
  const avatars: Participant[] = (people ?? []).map((p, i) => ({ name: p.name, color: participantPalette[i % participantPalette.length] }));
  return (
    <div className="on-dark relative isolate overflow-hidden rounded-[28px] text-cream">
      <Image
        src={cover.url}
        alt={cover.alt}
        fill
        preload
        unoptimized={!isUnsplash(cover.url)}
        sizes="(min-width: 1152px) 1104px, 100vw"
        className="-z-10 object-cover"
      />
      {onEdit && (
        <button
          type="button"
          onClick={onEdit}
          className="absolute right-3 top-3 inline-flex min-h-10 items-center gap-1.5 rounded-full bg-black/30 px-3 text-sm font-semibold text-cream backdrop-blur transition hover:bg-black/45 sm:right-4 sm:top-4"
        >
          <Pencil aria-hidden className="size-4" /> Editar viagem
        </button>
      )}
      <div className="absolute inset-0 -z-10 bg-linear-to-t from-[#0f2a24]/90 via-[#0f2a24]/45 to-[#0f2a24]/10" />
      <div className="flex min-h-[200px] flex-col justify-end gap-4 p-5 pt-16 sm:min-h-[220px] sm:flex-row sm:items-end sm:justify-between sm:p-8 sm:pt-16">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-medium text-cream/85">
            <MapPin aria-hidden className="size-4 shrink-0" /> <span className="wrap-anywhere">{trip.destination}</span>
          </p>
          <h1 className="mt-1 font-display text-4xl font-extrabold leading-none tracking-[-0.03em] wrap-anywhere sm:text-5xl">
            {trip.name}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-cream/90">
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays aria-hidden className="size-4" />
              {dateRange(trip.startDate, trip.endDate)}
            </span>
            {trip.stay && (
              <span className="inline-flex items-center gap-1.5">
                <BedDouble aria-hidden className="size-4" />
                <span className="wrap-anywhere">{trip.stay}</span>
              </span>
            )}
            {avatars.length > 0 && (
              <span className="inline-flex items-center gap-2">
                <AvatarStack people={avatars} size="size-7" className="[&>span]:ring-forest/60" />
                {avatars.length === 1 ? "Só você" : plural(avatars.length, "participante", "participantes")}
              </span>
            )}
          </div>
        </div>
        {(onShare || onExport || onPeople) && (
          <div className="flex shrink-0 flex-wrap gap-2">
            {onPeople && (
              <button
                type="button"
                onClick={onPeople}
                className="inline-flex h-10 items-center gap-2 rounded-full bg-white/15 px-4 text-sm font-semibold text-cream ring-1 ring-cream/40 backdrop-blur transition hover:bg-white/25"
              >
                <Users aria-hidden className="size-4" /> Participantes
              </button>
            )}
            {onShare && (
              <button
                type="button"
                onClick={onShare}
                className="inline-flex h-10 items-center gap-2 rounded-full bg-cream px-4 text-sm font-semibold text-forest shadow-soft transition hover:bg-white"
              >
                <Share2 aria-hidden className="size-4" /> Compartilhar
              </button>
            )}
            {onExport && (
              <button
                type="button"
                onClick={onExport}
                className="inline-flex h-10 items-center gap-2 rounded-full bg-white/15 px-4 text-sm font-semibold text-cream ring-1 ring-cream/40 backdrop-blur transition hover:bg-white/25"
              >
                <Download aria-hidden className="size-4" /> Exportar
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
