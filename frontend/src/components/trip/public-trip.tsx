"use client";

import { useQuery } from "@tanstack/react-query";
import { Eye, Link2Off, LoaderCircle, Map as MapIcon, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ApiError, errorMessage } from "@/api/client";
import { sharingApi } from "@/api/endpoints";
import { toPublicDays } from "@/api/mappers";
import { ActivityCard, TimelineList } from "@/components/editor/activity-card";
import { MapPanel } from "@/components/editor/map-panel";
import { TripCover } from "@/components/editor/trip-cover";
import { Button, buttonClasses } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import { overlapMap } from "@/lib/activities";
import { longDateTitle } from "@/lib/dates";
import { timeZoneLabel } from "@/lib/time-zones";

/**
 * Roteiro público somente leitura. Usa só a resposta de GET /public/trips/:token
 * (chave de cache própria, sem sessão e sem dados privados) e nenhuma ação de edição.
 */
export function PublicTrip({ token }: { token: string }) {
  const query = useQuery({
    queryKey: ["public-trip", token],
    queryFn: () => sharingApi.getPublic(token),
    gcTime: 0,
    retry: (count, e) => !(e instanceof ApiError) && count < 1,
  });

  return (
    <>
      <header className="border-b border-line bg-cream">
        <div className="mx-auto flex h-16 max-w-4xl items-center gap-3 px-4 sm:px-6">
          <Logo href="/" />
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-forest-100 px-3 py-1.5 text-xs font-semibold text-forest">
            <Eye aria-hidden className="size-3.5" /> Somente leitura
          </span>
        </div>
      </header>
      {query.isPending && (
        <main className="flex flex-1 items-center justify-center py-32" role="status">
          <LoaderCircle aria-hidden className="size-6 animate-spin text-forest" />
          <span className="sr-only">Carregando roteiro</span>
        </main>
      )}
      {query.isError && <Unavailable error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} />}
      {query.data && <PublicBody data={query.data} />}
    </>
  );
}

function PublicBody({ data }: { data: NonNullable<Awaited<ReturnType<typeof sharingApi.getPublic>>> }) {
  const days = toPublicDays(data);
  // Um mapa por vez: abre sob demanda em cada dia
  const [mapDayId, setMapDayId] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 pb-20 pt-4 sm:px-6 sm:pt-6">
      <TripCover trip={{ ...data, stay: undefined }} />
      <p className="mt-4 rounded-2xl border border-line bg-white px-4 py-3 text-sm text-ink-soft">
        Horários no fuso do destino: {timeZoneLabel(data.timeZone)}. Locais, preços e horários de funcionamento não são
        verificados pelo BoraAli.
      </p>
      {days.map((d, i) => (
        <section key={d.id} aria-labelledby={`dia-${d.id}`} className="mt-10">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-coral-700">Dia {i + 1}</p>
          <h2 id={`dia-${d.id}`} className="mt-1 font-display text-2xl font-bold text-forest">
            {longDateTitle(d.date)}
          </h2>
          {d.title && <p className="text-sm text-ink-soft">{d.title}</p>}
          {d.activities.some((a) => a.place) && (
            <button
              type="button"
              onClick={() => {
                setHighlightId(null);
                setMapDayId((cur) => (cur === d.id ? null : d.id));
              }}
              aria-expanded={mapDayId === d.id}
              aria-controls={`mapa-${d.id}`}
              className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-full border border-line bg-white px-3.5 text-sm font-semibold text-forest hover:border-forest/40"
            >
              <MapIcon aria-hidden className="size-4" /> {mapDayId === d.id ? "Ocultar mapa do dia" : "Ver mapa do dia"}
            </button>
          )}
          {mapDayId === d.id && (
            <div id={`mapa-${d.id}`} className="mt-4">
              <MapPanel
                dayId={d.id}
                activities={d.activities}
                destination={data.destinationCenter}
                highlightId={highlightId}
                onSelect={setHighlightId}
                onShowInList={(id) => document.getElementById(`atividade-${id}`)?.scrollIntoView({ block: "center" })}
                active
              />
            </div>
          )}
          {d.activities.length === 0 ? (
            <p className="mt-4 rounded-2xl border border-dashed border-line px-4 py-6 text-center text-sm text-ink-soft">
              Nada planejado para este dia ainda.
            </p>
          ) : (
            <div className="mt-5">
              <TimelineList>
                {d.activities.map((a) => (
                  <ActivityCard
                    key={a.id}
                    activity={a}
                    overlap={overlapMap(d.activities)[a.id]}
                    highlighted={highlightId === a.id}
                    readOnly
                  />
                ))}
              </TimelineList>
            </div>
          )}
        </section>
      ))}
      <p className="mt-12 text-center text-sm text-ink-soft">
        Feito com o BoraAli.{" "}
        <Link href="/" className="font-semibold text-forest underline underline-offset-4">
          Monte o seu roteiro
        </Link>
      </p>
    </main>
  );
}

function Unavailable({ error, onRetry, retrying }: { error: unknown; onRetry: () => void; retrying: boolean }) {
  // Link inválido, desativado ou suspenso recebem a mesma mensagem neutra
  const network = !(error instanceof ApiError) || error.status >= 500;
  return (
    <main className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center px-6 py-24 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-forest-100 text-forest">
        <Link2Off aria-hidden className="size-7" />
      </span>
      <h1 className="mt-4 font-display text-3xl font-bold text-forest">
        {network ? "Não foi possível abrir o roteiro" : "Este link não está disponível"}
      </h1>
      <p className="mt-2 text-ink-soft">
        {network ? errorMessage(error) : "Peça um novo link para quem compartilhou o roteiro com você."}
      </p>
      {network ? (
        <Button className="mt-6" onClick={onRetry} disabled={retrying}>
          <RefreshCw aria-hidden className={retrying ? "size-4 animate-spin" : "size-4"} /> Tentar novamente
        </Button>
      ) : (
        <Link href="/" className={buttonClasses("primary", "md", "mt-6")}>
          Conhecer o BoraAli
        </Link>
      )}
    </main>
  );
}
