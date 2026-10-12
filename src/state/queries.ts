"use client";

import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { isApiError } from "@/api/client";
import { aiApi, invitationsApi, membersApi, sharingApi, tripsApi } from "@/api/endpoints";
import { toTrip, toTripSummary } from "@/api/mappers";
import { useAuth } from "./providers";

/** Chaves das consultas privadas (todas são descartadas no logout). */
export const keys = {
  trips: ["trips"] as const,
  trip: (id: string) => ["trip", id] as const,
  entitlements: (id: string) => ["entitlements", id] as const,
  members: (id: string) => ["members", id] as const,
  invitations: (id: string) => ["invitations", id] as const,
  share: (id: string) => ["share", id] as const,
  aiUsage: (id: string) => ["ai-usage", id] as const,
  aiJobs: (id: string) => ["ai-jobs", id] as const,
  aiJob: (id: string, jobId: string) => ["ai-job", id, jobId] as const,
};

function useSignedIn() {
  return useAuth().state.status === "authenticated";
}

export function useTripsQuery() {
  return useQuery({
    queryKey: keys.trips,
    queryFn: async () => (await tripsApi.list("all")).map(toTripSummary),
    enabled: useSignedIn(),
  });
}

export function useTripQuery(id: string) {
  return useQuery({
    queryKey: keys.trip(id),
    queryFn: async () => toTrip(await tripsApi.get(id)),
    enabled: useSignedIn(),
    // Viagem inexistente ou sem acesso: não adianta repetir
    retry: (count, e) => !isApiError(e) && count < 1,
  });
}

export function useEntitlements(id: string) {
  return useQuery({ queryKey: keys.entitlements(id), queryFn: () => tripsApi.entitlements(id), enabled: useSignedIn() });
}

export function useMembers(id: string) {
  return useQuery({ queryKey: keys.members(id), queryFn: () => membersApi.list(id), enabled: useSignedIn() });
}

export function useInvitations(id: string, enabled: boolean) {
  return useQuery({
    queryKey: keys.invitations(id),
    queryFn: () => invitationsApi.list(id),
    enabled: useSignedIn() && enabled,
  });
}

export function useShareLink(id: string, enabled: boolean) {
  return useQuery({ queryKey: keys.share(id), queryFn: () => sharingApi.get(id), enabled: useSignedIn() && enabled });
}

export function useAiUsage(id: string, enabled: boolean) {
  return useQuery({ queryKey: keys.aiUsage(id), queryFn: () => aiApi.usage(id), enabled: useSignedIn() && enabled });
}

/** Recarrega a viagem e tudo que depende do roteiro. */
export function invalidateTrip(qc: QueryClient, id: string) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: keys.trip(id) }),
    qc.invalidateQueries({ queryKey: keys.trips }),
    qc.invalidateQueries({ queryKey: keys.entitlements(id) }),
    qc.invalidateQueries({ queryKey: keys.aiUsage(id) }),
  ]);
}

export function useRefreshTrip(id: string) {
  const qc = useQueryClient();
  return useCallback(() => invalidateTrip(qc, id), [qc, id]);
}
