/**
 * Tipos de domínio usados pelas telas. Os dados autenticados vêm da API
 * (src/api) e são convertidos para estes formatos em src/api/mappers.ts.
 */
import type { ApiCategory, PlaceProvider, Plan, Role } from "@/api/contracts";

export type { Plan, Role };

export type Category = ApiCategory;

/** Lugar real de uma atividade (coordenadas do provedor de geocodificação). */
export interface ActivityPlace {
  latitude: number;
  longitude: number;
  formattedAddress?: string;
  placeId?: string;
  provider?: PlaceProvider;
}

/** Localização confirmada do destino, usada para orientar buscas e centralizar o mapa. */
export interface DestinationPlace {
  latitude: number;
  longitude: number;
  formattedAddress?: string;
}

/** Conteúdo de uma atividade, comum ao roteiro real, ao link público e aos exemplos da landing. */
export interface ActivityContent {
  id: string;
  /** Horário local do destino (fuso da viagem), no formato HH:MM */
  time: string;
  title: string;
  location?: string;
  /** Duração em minutos. Sem duração, a atividade é tratada como um compromisso pontual. */
  durationMin?: number;
  category: Category;
  notes?: string;
  /** Sem `place`, o local é só texto e a atividade não aparece no mapa. */
  place?: ActivityPlace;
}

/** Atividade persistida na API. `version` é exigida para editar, mover e excluir. */
export interface Activity extends ActivityContent {
  dayId: string;
  version: number;
  /** Desempate entre atividades no mesmo horário */
  position: number;
}

export interface DayContent<A extends ActivityContent = ActivityContent> {
  id: string;
  /** Data local YYYY-MM-DD, sem fuso */
  date: string;
  title?: string;
  /** Sempre ordenadas por horário e depois por posição */
  activities: A[];
}

export interface TripDay extends DayContent<Activity> {
  /** O plano ainda permite adicionar atividades neste dia */
  canAddActivities: boolean;
}

export interface Trip {
  id: string;
  ownerId: string;
  name: string;
  destination: string;
  startDate: string;
  endDate: string;
  /** Fuso IANA do destino, ex.: "America/Sao_Paulo" */
  timeZone: string;
  coverUrl: string | null;
  stay?: string;
  destinationPlace: DestinationPlace | null;
  plan: Plan;
  /** Papel do usuário atual nesta viagem */
  role: Role;
  updatedAt: string;
  days: TripDay[];
}

export interface TripSummary {
  id: string;
  ownerId: string;
  ownerName: string;
  name: string;
  destination: string;
  startDate: string;
  endDate: string;
  coverUrl: string | null;
  stay?: string;
  plan: Plan;
  role: Role;
  dayCount: number;
  activityCount: number;
  /** false quando o acesso de convidado está suspenso pelo plano da viagem */
  accessible: boolean;
}

/** Roteiro de exemplo da landing page (dados ilustrativos, não vêm da API). */
export interface Participant {
  name: string;
  color: string;
}

export interface ExampleTrip {
  id: string;
  name: string;
  destination: string;
  startDate: string;
  endDate: string;
  timeZone: string;
  coverUrl: string;
  coverAlt: string;
  stay?: string;
  participants: Participant[];
  days: DayContent[];
  isExample: true;
}

/** Sugestão ilustrativa exibida na landing page */
export interface Suggestion {
  id: string;
  time: string;
  title: string;
  location: string;
  durationMin: number;
  category: Category;
  reason: string;
  interests: string[];
}
