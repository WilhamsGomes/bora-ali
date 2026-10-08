import { apiFetch } from "./client";
import type {
  AcceptInvitationResultDto,
  ActivityInputDto,
  ActivityMutationResultDto,
  AdjustItineraryRequestDto,
  AiEntitlementDto,
  AiJobDto,
  AuthResponseDto,
  BatchCreateResultDto,
  CheckoutResponseDto,
  CreateTripDto,
  DayDto,
  DaySuggestionsRequestDto,
  EntitlementsDto,
  InvitationDto,
  InvitationPreviewDto,
  MemberDto,
  OrderDto,
  PlaceSearchResultDto,
  PublicTripDto,
  Role,
  ShareLinkDto,
  TripDetailDto,
  TripSuggestionsRequestDto,
  TripSummaryDto,
  UpdateActivityDto,
  UpdateTripDto,
  UserDto,
} from "./contracts";

/** Um método por endpoint real de /api/v1 (ver /api/docs). */

const enc = encodeURIComponent;
const trip = (id: string) => `/trips/${enc(id)}`;

export const authApi = {
  register: (body: { name: string; email: string; password: string }) =>
    apiFetch<AuthResponseDto>("/auth/register", { method: "POST", body, auth: false, withCredentials: true }),
  login: (body: { email: string; password: string }) =>
    apiFetch<AuthResponseDto>("/auth/login", { method: "POST", body, auth: false, withCredentials: true }),
  logout: () => apiFetch<void>("/auth/logout", { method: "POST", auth: false, withCredentials: true }),
  me: () => apiFetch<UserDto>("/auth/me"),
};

export const tripsApi = {
  list: (scope: "all" | "owned" | "shared" = "all") => apiFetch<TripSummaryDto[]>(`/trips?scope=${scope}`),
  get: (id: string) => apiFetch<TripDetailDto>(trip(id)),
  create: (body: CreateTripDto) => apiFetch<TripDetailDto>("/trips", { method: "POST", body }),
  update: (id: string, body: UpdateTripDto) => apiFetch<TripDetailDto>(trip(id), { method: "PATCH", body }),
  remove: (id: string) => apiFetch<void>(trip(id), { method: "DELETE" }),
  entitlements: (id: string) => apiFetch<EntitlementsDto>(`${trip(id)}/entitlements`),
};

export const itineraryApi = {
  updateDay: (tripId: string, dayId: string, title: string | null) =>
    apiFetch<DayDto>(`${trip(tripId)}/days/${enc(dayId)}`, { method: "PATCH", body: { title } }),
  createActivity: (tripId: string, dayId: string, body: ActivityInputDto) =>
    apiFetch<ActivityMutationResultDto>(`${trip(tripId)}/days/${enc(dayId)}/activities`, { method: "POST", body }),
  batchCreate: (tripId: string, items: (ActivityInputDto & { dayId: string })[]) =>
    apiFetch<BatchCreateResultDto>(`${trip(tripId)}/activities/batch`, { method: "POST", body: { items } }),
  updateActivity: (tripId: string, activityId: string, body: UpdateActivityDto) =>
    apiFetch<ActivityMutationResultDto>(`${trip(tripId)}/activities/${enc(activityId)}`, { method: "PATCH", body }),
  deleteActivity: (tripId: string, activityId: string, version: number) =>
    apiFetch<void>(`${trip(tripId)}/activities/${enc(activityId)}?version=${version}`, { method: "DELETE" }),
  reorder: (tripId: string, dayId: string, items: { id: string; version: number }[]) =>
    apiFetch<DayDto>(`${trip(tripId)}/days/${enc(dayId)}/activities/order`, { method: "PUT", body: { items } }),
};

export const placesApi = {
  /** Autocomplete de lugares. `signal` cancela buscas antigas enquanto a pessoa digita. */
  search: (tripId: string, q: string, kind: "place" | "destination", signal?: AbortSignal) =>
    apiFetch<PlaceSearchResultDto>(`${trip(tripId)}/places/search?${new URLSearchParams({ q, kind })}`, { signal }),
};

export const membersApi = {
  list: (tripId: string) => apiFetch<MemberDto[]>(`${trip(tripId)}/members`),
  updateRole: (tripId: string, userId: string, role: Exclude<Role, "OWNER">) =>
    apiFetch<MemberDto>(`${trip(tripId)}/members/${enc(userId)}`, { method: "PATCH", body: { role } }),
  remove: (tripId: string, userId: string) => apiFetch<void>(`${trip(tripId)}/members/${enc(userId)}`, { method: "DELETE" }),
};

export const invitationsApi = {
  list: (tripId: string) => apiFetch<InvitationDto[]>(`${trip(tripId)}/invitations`),
  create: (tripId: string, body: { email: string; role: Exclude<Role, "OWNER"> }) =>
    apiFetch<InvitationDto>(`${trip(tripId)}/invitations`, { method: "POST", body }),
  resend: (tripId: string, id: string) =>
    apiFetch<InvitationDto>(`${trip(tripId)}/invitations/${enc(id)}/resend`, { method: "POST" }),
  revoke: (tripId: string, id: string) => apiFetch<void>(`${trip(tripId)}/invitations/${enc(id)}`, { method: "DELETE" }),
  preview: (token: string) =>
    apiFetch<InvitationPreviewDto>("/invitations/preview", { method: "POST", body: { token }, auth: false }),
  accept: (token: string) => apiFetch<AcceptInvitationResultDto>("/invitations/accept", { method: "POST", body: { token } }),
};

export const sharingApi = {
  get: (tripId: string) => apiFetch<ShareLinkDto>(`${trip(tripId)}/share`),
  update: (tripId: string, body: { enabled: boolean; showNotes?: boolean }) =>
    apiFetch<ShareLinkDto>(`${trip(tripId)}/share`, { method: "PUT", body }),
  rotate: (tripId: string) => apiFetch<ShareLinkDto>(`${trip(tripId)}/share/rotate`, { method: "POST" }),
  /** Rota pública: sem token e sem renovação de sessão */
  getPublic: (token: string) => apiFetch<PublicTripDto>(`/public/trips/${enc(token)}`, { auth: false }),
};

export const billingApi = {
  checkout: (tripId: string, plan: "PRO" | "PRO_AI") =>
    apiFetch<CheckoutResponseDto>("/billing/checkout", { method: "POST", body: { tripId, plan } }),
  order: (orderId: string) => apiFetch<OrderDto>(`/billing/orders/${enc(orderId)}`),
  tripOrders: (tripId: string) => apiFetch<OrderDto[]>(`${trip(tripId)}/orders`),
};

export const aiApi = {
  usage: (tripId: string) => apiFetch<AiEntitlementDto>(`${trip(tripId)}/ai/usage`),
  daySuggestions: (tripId: string, body: DaySuggestionsRequestDto, key: string) =>
    apiFetch<AiJobDto>(`${trip(tripId)}/ai/day-suggestions`, { method: "POST", body, headers: { "Idempotency-Key": key } }),
  tripSuggestions: (tripId: string, body: TripSuggestionsRequestDto, key: string) =>
    apiFetch<AiJobDto>(`${trip(tripId)}/ai/trip-suggestions`, { method: "POST", body, headers: { "Idempotency-Key": key } }),
  adjustments: (tripId: string, body: AdjustItineraryRequestDto, key: string) =>
    apiFetch<AiJobDto>(`${trip(tripId)}/ai/adjustments`, { method: "POST", body, headers: { "Idempotency-Key": key } }),
  jobs: (tripId: string) => apiFetch<AiJobDto[]>(`${trip(tripId)}/ai/jobs`),
  job: (tripId: string, jobId: string) => apiFetch<AiJobDto>(`${trip(tripId)}/ai/jobs/${enc(jobId)}`),
};
