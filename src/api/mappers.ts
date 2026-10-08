import type { Activity, ActivityContent, ActivityPlace, DayContent, Trip, TripDay, TripSummary } from "@/lib/types";
import type {
  ActivityDto,
  ActivityInputDto,
  DayDto,
  PlaceProvider,
  ProposedActivityDto,
  PublicTripDto,
  TripDetailDto,
  TripSummaryDto,
} from "./contracts";

/** Converte os contratos da API para os tipos das telas. Datas e horários passam intactos (sem fuso). */

const opt = <T>(v: T | null | undefined) => (v === null || v === undefined || v === "" ? undefined : v);

/** Lugar só existe com o par de coordenadas completo. */
export function toPlace(a: {
  latitude?: number | null;
  longitude?: number | null;
  formattedAddress?: string | null;
  placeId?: string | null;
  placeProvider?: PlaceProvider | null;
}): ActivityPlace | undefined {
  if (typeof a.latitude !== "number" || typeof a.longitude !== "number") return undefined;
  return {
    latitude: a.latitude,
    longitude: a.longitude,
    formattedAddress: opt(a.formattedAddress),
    placeId: opt(a.placeId),
    provider: opt(a.placeProvider),
  };
}

export function toActivity(a: ActivityDto): Activity {
  return {
    id: a.id,
    dayId: a.dayId,
    time: a.time,
    title: a.title,
    location: opt(a.location),
    durationMin: opt(a.durationMinutes),
    category: a.category,
    notes: opt(a.notes),
    place: toPlace(a),
    version: a.version,
    position: a.position,
  };
}

export function toDay(d: DayDto): TripDay {
  return {
    id: d.id,
    date: d.date,
    title: opt(d.title),
    activities: d.activities.map(toActivity),
    canAddActivities: d.canAddActivities,
  };
}

export function toTrip(t: TripDetailDto): Trip {
  return {
    id: t.id,
    ownerId: t.ownerId,
    name: t.name,
    destination: t.destination,
    startDate: t.startDate,
    endDate: t.endDate,
    timeZone: t.timeZone,
    coverUrl: t.coverUrl,
    stay: opt(t.stay),
    destinationPlace: t.destinationPlace
      ? {
          latitude: t.destinationPlace.latitude,
          longitude: t.destinationPlace.longitude,
          formattedAddress: opt(t.destinationPlace.formattedAddress),
        }
      : null,
    plan: t.plan,
    role: t.role,
    updatedAt: t.updatedAt,
    days: [...t.days].sort((a, b) => a.date.localeCompare(b.date)).map(toDay),
  };
}

export function toTripSummary(t: TripSummaryDto): TripSummary {
  return {
    id: t.id,
    ownerId: t.ownerId,
    ownerName: t.ownerName,
    name: t.name,
    destination: t.destination,
    startDate: t.startDate,
    endDate: t.endDate,
    coverUrl: t.coverUrl,
    stay: opt(t.stay),
    plan: t.plan,
    role: t.role,
    dayCount: t.dayCount,
    activityCount: t.activityCount,
    accessible: t.accessible,
  };
}

/** Viagem pública: só os campos recebidos; IDs locais servem apenas como chave de lista. */
export function toPublicDays(t: PublicTripDto): DayContent[] {
  return t.days.map((d, i) => ({
    id: `dia-${i + 1}`,
    date: d.date,
    title: opt(d.title),
    activities: d.activities.map((a, j) => ({
      id: `dia-${i + 1}-${j + 1}`,
      time: a.time,
      title: a.title,
      location: opt(a.location),
      durationMin: opt(a.durationMinutes),
      category: a.category,
      notes: opt(a.notes),
      place: toPlace(a),
    })),
  }));
}

/**
 * Conteúdo editável → corpo de criação/edição. Campos vazios viram null para limpar no servidor.
 * `place: false` omite o lugar: o servidor mantém o ponto atual se o texto do local não mudar
 * (e o limpa se mudar). Use em alterações que não escolhem lugar, como os ajustes da IA.
 */
export function toActivityInput(a: Omit<ActivityContent, "id">, options: { place?: boolean } = {}): ActivityInputDto {
  const base: ActivityInputDto = {
    title: a.title,
    time: a.time,
    category: a.category,
    location: a.location ?? null,
    durationMinutes: a.durationMin ?? null,
    notes: a.notes ?? null,
  };
  if (options.place === false) return base;
  // Sempre envia o lugar completo (ou tudo null): o servidor trata o lugar como unidade.
  return {
    ...base,
    formattedAddress: a.place?.formattedAddress ?? null,
    latitude: a.place?.latitude ?? null,
    longitude: a.place?.longitude ?? null,
    placeId: a.place?.placeId ?? null,
    placeProvider: a.place?.provider ?? null,
  };
}

export function fromProposed(p: ProposedActivityDto): Omit<ActivityContent, "id"> {
  return {
    title: p.title,
    time: p.time,
    category: p.category,
    location: opt(p.location),
    durationMin: opt(p.durationMinutes),
    notes: opt(p.notes),
  };
}
