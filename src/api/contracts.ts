/**
 * Contratos da API do BoraAli (espelho de /api/docs/openapi.json).
 * Só tipos: nenhum campo aqui é inventado pelo frontend.
 */

export type ApiCategory = "passeio" | "alimentacao" | "transporte" | "descanso" | "hospedagem" | "outros";
export type Plan = "FREE" | "PRO" | "PRO_AI";
export type Role = "OWNER" | "EDITOR" | "VIEWER";
export type Product = "PRO" | "PRO_AI" | "UPGRADE_PRO_AI";

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  requestId: string;
}

/* Autenticação */

export interface UserDto {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

export interface AuthResponseDto {
  accessToken: string;
  expiresIn: number;
  user: UserDto;
}

/* Localização */

export type PlaceProvider = "geoapify";

/** Localização confirmada do destino da viagem */
export interface DestinationPlaceDto {
  latitude: number;
  longitude: number;
  formattedAddress?: string | null;
  placeId?: string | null;
  provider?: PlaceProvider | null;
}

export interface PlaceSuggestionDto {
  provider: PlaceProvider;
  placeId: string;
  name: string;
  formattedAddress: string;
  secondary: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  countryCode: string | null;
  latitude: number;
  longitude: number;
  resultType: string | null;
}

export interface PlaceSearchResultDto {
  results: PlaceSuggestionDto[];
  attribution: string;
  biasedToDestination: boolean;
}

/* Viagens */

export interface TripBaseDto {
  id: string;
  name: string;
  destination: string;
  startDate: string;
  endDate: string;
  timeZone: string;
  ownerId: string;
  stay: string | null;
  coverUrl: string | null;
  destinationPlace: DestinationPlaceDto | null;
  plan: Plan;
  role: Role;
  createdAt: string;
  updatedAt: string;
}

export interface TripSummaryDto extends TripBaseDto {
  dayCount: number;
  activityCount: number;
  ownerName: string;
  accessible: boolean;
}

export interface TripDetailDto extends TripBaseDto {
  days: DayDto[];
}

export interface CreateTripDto {
  name: string;
  destination: string;
  startDate: string;
  endDate: string;
  timeZone: string;
  stay?: string | null;
  coverUrl?: string | null;
  /** null limpa. Mudar `destination` sem este campo também limpa a localização anterior. */
  destinationPlace?: DestinationPlaceDto | null;
}

export interface UpdateTripDto extends Partial<CreateTripDto> {
  confirmRemoveDates?: string[];
}

export interface AffectedDayDto {
  dayId: string;
  date: string;
  activityCount: number;
}

/* Dias e atividades */

export interface ActivityDto {
  id: string;
  tripId: string;
  dayId: string;
  title: string;
  time: string;
  category: ApiCategory;
  location?: string | null;
  durationMinutes?: number | null;
  notes?: string | null;
  formattedAddress?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  placeId?: string | null;
  placeProvider?: PlaceProvider | null;
  position: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface OverlapWarningDto {
  code: string;
  activityId: string;
  overlapsWithActivityId: string;
  message: string;
}

export interface DayDto {
  id: string;
  date: string;
  title: string | null;
  activities: ActivityDto[];
  warnings: OverlapWarningDto[];
  canAddActivities: boolean;
}

export interface ActivityInputDto {
  title: string;
  time: string;
  category?: ApiCategory;
  location?: string | null;
  durationMinutes?: number | null;
  notes?: string | null;
  /**
   * O lugar é uma unidade: enviar qualquer campo substitui o lugar inteiro.
   * Mudar `location` sem estes campos limpa as coordenadas anteriores no servidor.
   */
  formattedAddress?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  placeId?: string | null;
  placeProvider?: PlaceProvider | null;
}

export interface UpdateActivityDto extends Partial<ActivityInputDto> {
  version: number;
  dayId?: string;
}

export interface ActivityMutationResultDto {
  activity: ActivityDto;
  warnings: OverlapWarningDto[];
}

export interface BatchCreateResultDto {
  activities: ActivityDto[];
  warnings: OverlapWarningDto[];
}

/* Planos */

export interface UpgradeOptionDto {
  plan: Plan;
  product: Product;
  amount: number;
  currency: string;
}

export type AiKind = "DAY_SUGGESTIONS" | "TRIP_SUGGESTIONS" | "ADJUST_ITINERARY";

export interface AiKindUsageDto {
  limit: number;
  used: number;
  reserved: number;
  remaining: number;
}

export interface AiEntitlementDto {
  enabled: boolean;
  available: boolean;
  unavailableReason?: "PROVIDER_NOT_CONFIGURED" | "AI_BUDGET_EXHAUSTED";
  canRequest: boolean;
  usage: Record<AiKind, AiKindUsageDto>;
}

export interface EntitlementsDto {
  tripId: string;
  plan: Plan;
  role: Role;
  maxActivitiesPerDay: number | null;
  collaboration: boolean;
  publicSharing: boolean;
  ai: AiEntitlementDto;
  canPurchase: boolean;
  availableUpgrades: UpgradeOptionDto[];
  hasPendingOrder: boolean;
}

/* Pagamentos */

export type OrderStatus =
  | "CREATED"
  | "OPEN"
  | "PROCESSING"
  | "PAID"
  | "FAILED"
  | "EXPIRED"
  | "CANCELED"
  | "REFUNDED"
  | "DISPUTED";

export interface OrderDto {
  id: string;
  tripId: string | null;
  product: Product;
  targetPlan: Plan;
  amount: number;
  currency: string;
  status: OrderStatus;
  checkoutUrl: string | null;
  checkoutExpiresAt: string | null;
  paidAt: string | null;
  failureReason?: string | null;
  tripPlan: Plan;
  createdAt: string;
  updatedAt: string;
}

export interface CheckoutResponseDto {
  order: OrderDto;
  checkoutUrl: string;
  reused: boolean;
}

/* Participantes e convites */

export interface MemberDto {
  userId: string;
  name: string;
  email: string;
  role: Role;
  joinedAt: string;
}

export type InvitationStatus = "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";

export interface InvitationDto {
  id: string;
  tripId: string;
  email: string;
  role: Role;
  status: InvitationStatus;
  expiresAt: string;
  createdAt: string;
  delivery: {
    status: "PENDING" | "PROVIDER_ACCEPTED" | "FAILED";
    provider: string | null;
    sends: number;
    lastAttemptAt: string | null;
    providerAcceptedAt: string | null;
    errorCode: string | null;
  };
}

export interface InvitationPreviewDto {
  tripName: string;
  destination: string;
  startDate: string;
  endDate: string;
  inviterName: string;
  role: Role;
  emailHint: string;
  status: InvitationStatus;
  expiresAt: string;
}

export interface AcceptInvitationResultDto {
  tripId: string;
  role: Role;
}

/* Link público */

export interface ShareLinkDto {
  enabled: boolean;
  active: boolean;
  showNotes: boolean;
  url: string | null;
  token: string | null;
}

export interface PublicActivityDto {
  title: string;
  time: string;
  category: ApiCategory;
  location: string | null;
  durationMinutes: number | null;
  /** null em atividades de hospedagem */
  formattedAddress: string | null;
  latitude: number | null;
  longitude: number | null;
  notes?: string | null;
}

export interface PublicTripDto {
  name: string;
  destination: string;
  startDate: string;
  endDate: string;
  timeZone: string;
  coverUrl: string | null;
  destinationCenter: { latitude: number; longitude: number } | null;
  days: { date: string; title: string | null; activities: PublicActivityDto[] }[];
}

/* IA */

export type Pace = "tranquilo" | "equilibrado" | "intenso";
export type Budget = "economico" | "moderado" | "confortavel";

export interface AiPreferences {
  interests?: string[];
  pace?: Pace;
  budget?: Budget;
  prompt?: string;
}

export interface DaySuggestionsRequestDto extends AiPreferences {
  dayId: string;
}

export interface TripSuggestionsRequestDto extends AiPreferences {
  dayIds?: string[];
}

export interface AdjustItineraryRequestDto {
  instruction: string;
  dayIds?: string[];
}

export interface VerificationDto {
  status: "UNVERIFIED" | "VERIFIED";
  sources: unknown[];
  note: string;
}

export interface ProposedActivityDto {
  title: string;
  time: string;
  durationMinutes: number | null;
  category: ApiCategory;
  location: string | null;
  notes: string | null;
}

export interface SuggestedActivityDto extends ProposedActivityDto {
  suggestionId: string;
  dayId: string;
  date: string;
  reason: string;
  estimatedCost: { amount: number | null; currency: string | null; note: string | null };
  verification: VerificationDto;
}

export interface ProposedChangeDto {
  changeId: string;
  type: "add" | "update" | "remove";
  dayId: string;
  date: string;
  activityId: string | null;
  baseVersion: number | null;
  activity: ProposedActivityDto;
  reason: string;
  verification: VerificationDto;
}

export type AiJobStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";

export interface AiJobDto {
  id: string;
  tripId: string;
  kind: AiKind;
  status: AiJobStatus;
  input: Record<string, unknown>;
  result: {
    type: "suggestions" | "adjustment";
    suggestions?: SuggestedActivityDto[];
    summary?: string;
    changes?: ProposedChangeDto[];
    notes: string[];
    discarded: number;
  } | null;
  error: { code: string; message: string } | null;
  requestedById: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}
