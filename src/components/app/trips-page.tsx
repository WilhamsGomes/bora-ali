"use client";

import { Compass, Plus, RefreshCw, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { errorMessage } from "@/api/client";
import { Button } from "@/components/ui/button";
import { todayISO } from "@/lib/dates";
import type { TripSummary } from "@/lib/types";
import { useClientNow } from "@/lib/use-client-now";
import { useAuth } from "@/state/providers";
import { useTripsQuery } from "@/state/queries";
import { NewTripModal } from "./new-trip-modal";
import { TripCard, TripCardSkeleton } from "./trip-card";

function greeting(now: Date | null) {
  if (!now) return "Olá";
  const h = now.getHours();
  if (h < 5) return "Boa noite";
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
}

/** Próximas primeiro; as que já passaram vão para o fim, da mais recente para a mais antiga. */
function byUpcoming(today: string | null) {
  return (a: TripSummary, b: TripSummary) => {
    if (!today) return a.startDate.localeCompare(b.startDate);
    const pa = a.endDate < today;
    const pb = b.endDate < today;
    if (pa !== pb) return pa ? 1 : -1;
    return pa ? b.startDate.localeCompare(a.startDate) : a.startDate.localeCompare(b.startDate);
  };
}

export function TripsPage() {
  const query = useTripsQuery();
  const { state } = useAuth();
  const now = useClientNow();
  const [creating, setCreating] = useState(false);
  const today = now ? todayISO(now) : null;
  const firstName = state.status === "authenticated" ? state.user.name.split(/\s+/)[0] : "";

  const trips = query.data ? [...query.data].sort(byUpcoming(today)) : null;
  const owned = trips?.filter((t) => t.role === "OWNER") ?? [];
  const shared = trips?.filter((t) => t.role !== "OWNER") ?? [];
  const featured = owned.find((t) => t.accessible) ?? null;
  const rest = owned.filter((t) => t.id !== featured?.id);

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-20 pt-8 sm:px-6 sm:pt-12">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-base font-medium text-ink-soft">
            {greeting(now)}
            {firstName ? `, ${firstName}` : ""} 👋
          </p>
          <h1 className="mt-1 font-display text-4xl font-extrabold tracking-[-0.03em] text-forest sm:text-5xl">
            Suas próximas histórias
          </h1>
        </div>
        <Button variant="coral" onClick={() => setCreating(true)} className="self-start sm:self-auto">
          <Plus aria-hidden className="size-5" />
          Nova viagem
        </Button>
      </div>

      <section aria-label="Viagens" className="mt-10">
        {query.isError && !trips && (
          <div role="alert" className="flex flex-col items-center rounded-[28px] border border-[#e8c98a] bg-[#fbf2df] px-6 py-12 text-center">
            <TriangleAlert aria-hidden className="size-8 text-[#7a5200]" />
            <h2 className="mt-3 font-display text-2xl font-bold text-forest">Não conseguimos carregar suas viagens</h2>
            <p className="mt-2 max-w-md text-ink-soft">{errorMessage(query.error)}</p>
            <Button variant="secondary" className="mt-6" onClick={() => void query.refetch()} disabled={query.isFetching}>
              <RefreshCw aria-hidden className={query.isFetching ? "size-4 animate-spin" : "size-4"} /> Tentar novamente
            </Button>
          </div>
        )}

        {query.isPending && (
          <div className="grid gap-6" aria-busy="true" aria-label="Carregando viagens">
            <TripCardSkeleton featured />
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              <TripCardSkeleton />
              <TripCardSkeleton />
            </div>
          </div>
        )}

        {trips && owned.length === 0 && (
          <div className="flex flex-col items-center rounded-[28px] border-2 border-dashed border-line bg-white/60 px-6 py-16 text-center">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-forest-100 text-forest">
              <Compass aria-hidden className="size-7" />
            </span>
            <h2 className="mt-4 font-display text-2xl font-bold text-forest">Nenhuma viagem criada por você ainda</h2>
            <p className="mt-2 max-w-sm text-ink-soft">Crie a primeira viagem e comece a montar o roteiro, dia por dia.</p>
            <Button className="mt-6" onClick={() => setCreating(true)}>
              <Plus aria-hidden className="size-5" /> Criar primeira viagem
            </Button>
          </div>
        )}

        {trips && (featured || rest.length > 0) && (
          <div className="grid gap-6">
            {featured && <TripCard trip={featured} featured today={today} />}
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {rest.map((t) => (
                <TripCard key={t.id} trip={t} today={today} />
              ))}
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="flex min-h-[220px] flex-col items-center justify-center gap-3 rounded-[28px] border-2 border-dashed border-line text-forest transition hover:border-forest/40 hover:bg-white/60"
              >
                <span className="flex size-12 items-center justify-center rounded-full bg-forest-100">
                  <Plus aria-hidden className="size-6" />
                </span>
                <span className="font-semibold">Planejar outra viagem</span>
              </button>
            </div>
          </div>
        )}
      </section>

      {shared.length > 0 && (
        <section aria-labelledby="titulo-compartilhadas" className="mt-14">
          <h2 id="titulo-compartilhadas" className="font-display text-2xl font-bold text-forest">
            Compartilhadas com você
          </h2>
          <div className="mt-5 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {shared.map((t) => (
              <TripCard key={t.id} trip={t} today={today} />
            ))}
          </div>
        </section>
      )}

      <NewTripModal open={creating} onClose={() => setCreating(false)} />
    </main>
  );
}
