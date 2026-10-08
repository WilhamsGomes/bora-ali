"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Crosshair, Maximize2, MapPinned, MapPinOff, Minimize2, Pencil } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { errorMessage } from "@/api/client";
import { tripsApi } from "@/api/endpoints";
import { toTrip } from "@/api/mappers";
import { PlaceAutocomplete } from "@/components/location/place-autocomplete";
import { DayMapLazy, MapPlaceholder } from "@/components/map/day-map-lazy";
import { Field } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { categories } from "@/lib/categories";
import { getMapConfig } from "@/lib/map-config";
import { dayMapPoints } from "@/lib/map-points";
import type { ActivityContent, DestinationPlace } from "@/lib/types";
import { cn } from "@/lib/utils";
import { invalidateTrip, keys } from "@/state/queries";

interface MapPanelProps<A extends ActivityContent> {
  /** Identifica o dia: trocar reenquadra o mapa */
  dayId: string;
  activities: A[];
  destination: DestinationPlace | null;
  highlightId: string | null;
  /** Pedido externo para centralizar um marcador (ex.: "Destacar no mapa" no card) */
  focus?: { id: string; seq: number } | null;
  /** Clique na lista: destaca (quem usa) e centraliza o marcador (este painel) */
  onSelect: (id: string) => void;
  /** "Ver na lista" no balão do marcador */
  onShowInList?: (id: string) => void;
  /** Editores: abre a atividade para escolher o local nas sugestões */
  onSetLocation?: (activity: A) => void;
  /** Proprietário: permite confirmar a localização do destino */
  destinationEditor?: { tripId: string; destinationText: string };
  /** Monta o mapa só quando o painel fica visível (evita carregar tiles escondidos) */
  active: boolean;
  /** Avisa quando o mapa é ampliado (quem usa remove contextos de empilhamento, ex.: sticky) */
  onExpandedChange?: (expanded: boolean) => void;
  className?: string;
}

export function MapPanel<A extends ActivityContent>({
  dayId,
  activities,
  destination,
  highlightId,
  focus: externalFocus = null,
  onSelect,
  onShowInList,
  onSetLocation,
  destinationEditor,
  active,
  onExpandedChange,
  className,
}: MapPanelProps<A>) {
  const config = useMemo(() => getMapConfig(), []);
  const points = useMemo(() => dayMapPoints(activities), [activities]);
  const [mounted, setMounted] = useState(active);
  const [expanded, setExpanded] = useState(false);
  const [fitRequest, setFitRequest] = useState(0);
  const [listFocus, setListFocus] = useState<{ id: string; seq: number } | null>(null);
  // O pedido mais recente vence (lista do painel ou pedido externo)
  const focus = !listFocus ? externalFocus : !externalFocus || listFocus.seq > externalFocus.seq ? listFocus : externalFocus;

  // Depois de aberto uma vez, o mapa continua montado (preserva posição e evita recarregar tiles)
  if (active && !mounted) setMounted(true);

  useEffect(() => {
    onExpandedChange?.(expanded);
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [expanded, onExpandedChange]);

  const located = points.clusters.length > 0;
  const emptyOverlay =
    activities.length === 0
      ? "Adicione atividades com local para vê-las no mapa."
      : "Nenhuma atividade deste dia tem local no mapa. Ao editar, escolha o local nas sugestões.";

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div
        className={cn(
          expanded
            ? "fixed inset-0 z-[60] flex flex-col gap-2 bg-cream p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-5"
            : "flex flex-col gap-2",
        )}
        role={expanded ? "dialog" : undefined}
        aria-modal={expanded || undefined}
        aria-label={expanded ? "Mapa do dia ampliado" : undefined}
      >
        <div className="flex items-center gap-2">
          {expanded && <p className="mr-auto font-display text-lg font-bold text-forest">Mapa do dia</p>}
          <button
            type="button"
            onClick={() => setFitRequest((n) => n + 1)}
            disabled={!config || !located}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line bg-white px-3 text-sm font-semibold text-forest transition hover:border-forest/40 disabled:opacity-50"
          >
            <Crosshair aria-hidden className="size-4" /> Ver todos os locais
          </button>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            disabled={!config}
            aria-pressed={expanded}
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-full border border-line bg-white px-3 text-sm font-semibold text-forest transition hover:border-forest/40 disabled:opacity-50",
              !expanded && "ml-auto",
            )}
          >
            {expanded ? <Minimize2 aria-hidden className="size-4" /> : <Maximize2 aria-hidden className="size-4" />}
            {expanded ? "Reduzir" : "Ampliar"}
          </button>
        </div>

        <div className={cn("w-full", expanded ? "min-h-0 flex-1" : "aspect-[4/4.2] max-lg:max-h-[60svh]")}>
          {!config ? (
            <MapPlaceholder>
              <div className="flex flex-col items-center gap-2">
                <MapPinOff aria-hidden className="size-7 text-forest/70" />
                <p className="max-w-60 text-sm font-medium text-forest">Mapa desativado neste ambiente.</p>
                {process.env.NODE_ENV === "development" && (
                  <p className="max-w-65 text-xs text-ink-soft">NEXT_PUBLIC_MAP_STYLE_URL=off (veja o README).</p>
                )}
              </div>
            </MapPlaceholder>
          ) : mounted ? (
            <DayMapLazy
              config={config}
              clusters={points.clusters}
              viewKey={dayId}
              center={destination}
              highlightId={highlightId}
              focus={focus}
              fitRequest={fitRequest}
              onSelectActivity={
                onShowInList
                  ? (id) => {
                      setExpanded(false);
                      onShowInList(id);
                    }
                  : undefined
              }
              emptyOverlay={emptyOverlay}
              className="size-full"
            />
          ) : (
            <MapPlaceholder />
          )}
        </div>
      </div>

      {activities.length > 0 && (
        <ol className="space-y-1" aria-label="Atividades do dia no mapa">
          {points.numbered.map(({ activity: a, number }) => {
            const hasPlace = !!a.place;
            return (
              <li key={a.id} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    onSelect(a.id);
                    setListFocus({ id: a.id, seq: Date.now() });
                  }}
                  disabled={!hasPlace}
                  aria-label={`${number}. ${a.title}, ${a.time}${hasPlace ? "" : ", sem local no mapa"}`}
                  className={cn(
                    "flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-1.5 text-left text-sm transition enabled:hover:bg-white",
                    highlightId === a.id && hasPlace && "bg-white shadow-soft",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
                      hasPlace ? "text-white" : "border border-dashed border-ink-soft/50 text-ink-soft",
                    )}
                    style={hasPlace ? { backgroundColor: categories[a.category].color } : undefined}
                  >
                    {number}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn("block truncate font-medium", hasPlace ? "text-ink" : "text-ink-soft")}>{a.title}</span>
                    {!hasPlace && <span className="block text-[11px] text-ink-soft">Sem local no mapa</span>}
                  </span>
                  <span className="text-xs tabular-nums text-ink-soft">{a.time}</span>
                </button>
                {!hasPlace && onSetLocation && (
                  <button
                    type="button"
                    onClick={() => onSetLocation(a)}
                    className="shrink-0 rounded-full px-2 py-1 text-xs font-semibold text-forest underline-offset-2 hover:bg-white hover:underline"
                  >
                    Definir no mapa
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      )}

      <DestinationNote destination={destination} editor={destinationEditor} />
    </div>
  );
}

/** Localização do destino: orienta as buscas e centraliza o mapa quando o dia não tem pontos. */
function DestinationNote({
  destination,
  editor,
}: {
  destination: DestinationPlace | null;
  editor?: { tripId: string; destinationText: string };
}) {
  const [editing, setEditing] = useState(false);
  if (destination && !editing) {
    return (
      <p className="flex items-start gap-2 text-xs text-ink-soft">
        <MapPinned aria-hidden className="mt-px size-3.5 shrink-0 text-forest" />
        <span className="min-w-0 flex-1 wrap-anywhere">
          Destino no mapa: {destination.formattedAddress ?? `${destination.latitude.toFixed(4)}, ${destination.longitude.toFixed(4)}`}
        </span>
        {editor && (
          <button type="button" onClick={() => setEditing(true)} className="inline-flex items-center gap-1 font-semibold text-forest hover:underline">
            <Pencil aria-hidden className="size-3" /> Alterar
          </button>
        )}
      </p>
    );
  }
  if (!editor) return null;
  return <DestinationConfirm {...editor} onDone={() => setEditing(false)} canCancel={!!destination} />;
}

function DestinationConfirm({
  tripId,
  destinationText,
  onDone,
  canCancel,
}: {
  tripId: string;
  destinationText: string;
  onDone: () => void;
  canCancel: boolean;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState(destinationText);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="rounded-2xl border border-line bg-white p-3.5">
      <p className="text-sm font-semibold text-forest">Confirme o destino no mapa</p>
      <p className="mt-0.5 text-xs text-ink-soft">
        Ajuda a centralizar o mapa e a priorizar lugares da região nas buscas — sem esconder passeios por perto.
      </p>
      <div className="mt-2.5">
        <Field label="Destino" required>
          {(p) => (
            <PlaceAutocomplete
              tripId={tripId}
              kind="destination"
              fieldProps={p}
              text={text}
              onTextChange={setText}
              placeholder="Ex.: Recife, Pernambuco"
              maxLength={160}
              onSelect={async ({ name, place }) => {
                setText(name);
                setSaving(true);
                setError(null);
                try {
                  const updated = await tripsApi.update(tripId, {
                    destinationPlace: {
                      latitude: place.latitude,
                      longitude: place.longitude,
                      formattedAddress: place.formattedAddress ?? null,
                      placeId: place.placeId ?? null,
                      provider: place.provider ?? null,
                    },
                  });
                  qc.setQueryData(keys.trip(tripId), toTrip(updated));
                  void invalidateTrip(qc, tripId);
                  toast.show("Destino confirmado no mapa");
                  onDone();
                } catch (e) {
                  setError(errorMessage(e, "Não foi possível salvar o destino."));
                } finally {
                  setSaving(false);
                }
              }}
            />
          )}
        </Field>
      </div>
      {saving && <p className="mt-2 text-xs text-ink-soft" role="status">Salvando destino…</p>}
      {error && (
        <p className="mt-2 text-xs font-medium text-[#b3261e]" role="alert">
          {error}
        </p>
      )}
      {canCancel && (
        <button type="button" onClick={onDone} className="mt-2 text-xs font-semibold text-ink-soft hover:underline">
          Cancelar
        </button>
      )}
    </div>
  );
}
