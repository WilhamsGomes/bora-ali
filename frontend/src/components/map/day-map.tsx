"use client";

import {
  AttributionControl,
  getVersion,
  LngLatBounds,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  Popup,
  setWorkerUrl,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { LoaderCircle, MapPinOff, RefreshCw, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { categories } from "@/lib/categories";
import { formatDuration } from "@/lib/dates";
import type { MapConfig } from "@/lib/map-config";
import { googleMapsUrl, pointsSignature, type MapCluster } from "@/lib/map-points";
import { cn } from "@/lib/utils";

export interface DayMapProps {
  config: MapConfig;
  clusters: MapCluster[];
  /** Muda ao trocar de dia: reenquadra todos os pontos e descarta o movimento manual anterior */
  viewKey: string;
  /** Centro do destino confirmado, usado quando o dia não tem pontos */
  center: { latitude: number; longitude: number } | null;
  /** Realça o marcador da atividade (sem mover o mapa) */
  highlightId?: string | null;
  /** Pedido explícito para centralizar no marcador de uma atividade (muda `seq` a cada pedido) */
  focus?: { id: string; seq: number } | null;
  /** Incrementar pede para enquadrar todos os pontos de novo ("Ver todos os locais") */
  fitRequest?: number;
  /** "Ver na lista" no balão do marcador */
  onSelectActivity?: (id: string) => void;
  /** Mensagem sobre o mapa quando o dia não tem pontos */
  emptyOverlay?: React.ReactNode;
  className?: string;
}

type Status = { kind: "loading" } | { kind: "ready" } | { kind: "error"; reason: "webgl" | "style" | "timeout" };

const SINGLE_ZOOM = 15;
const DESTINATION_ZOOM = 11;
const MAX_FIT_ZOOM = 15;
const LOAD_TIMEOUT_MS = 20_000;
/** Erros de tiles após o carregamento antes de avisar (erros isolados são comuns e se recuperam) */
const TILE_ERROR_THRESHOLD = 4;

let workerConfigured = false;
function configureWorker() {
  if (workerConfigured) return;
  // Publicado em public/vendor por scripts/copy-maplibre-worker.mjs (predev/prebuild)
  setWorkerUrl(new URL(`/vendor/maplibre-gl-worker.mjs?v=${getVersion()}`, window.location.origin).href);
  workerConfigured = true;
}

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Mapa real do dia (MapLibre GL). Renderiza só no cliente: carregue por `DayMapLazy`.
 * - Marcadores numerados pela ordem das atividades; coordenadas iguais viram um marcador com todos os itens.
 * - Reenquadra ao trocar de dia ou a pedido; mudanças de pontos no mesmo dia só reenquadram
 *   se a pessoa não moveu o mapa manualmente.
 * - Redimensiona com o contêiner (painel aberto, ampliado, rotação do celular).
 */
export function DayMap({
  config,
  clusters,
  viewKey,
  center,
  highlightId = null,
  focus = null,
  fitRequest = 0,
  onSelectActivity,
  emptyOverlay,
  className,
}: DayMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef(new Map<string, { marker: Marker; el: HTMLButtonElement; cluster: MapCluster }>());
  const popupRef = useRef<Popup | null>(null);
  const userMovedRef = useRef(false);
  const pendingFitRef = useRef(false);
  const [attempt, setAttempt] = useState(0);
  const [mapVersion, setMapVersion] = useState(0);
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [tilesFailing, setTilesFailing] = useState(false);

  // Valores mais recentes para callbacks registrados uma única vez (atualizado antes dos demais efeitos)
  const latest = useRef({ clusters, center, onSelectActivity });
  useEffect(() => {
    latest.current = { clusters, center, onSelectActivity };
  });

  const signature = pointsSignature(clusters);
  const contentKey = clustersContentKey(clusters);
  const centerKey = center ? `${center.latitude},${center.longitude}` : "";

  /** Enquadra todos os pontos; sem pontos, centraliza no destino. */
  const fitRef = useRef((animate: boolean) => {
    const map = mapRef.current;
    const el = containerRef.current;
    if (!map || !el) return;
    if (!el.clientWidth || !el.clientHeight) {
      // Contêiner oculto (aba Roteiro no celular, painel recolhido): enquadra quando aparecer
      pendingFitRef.current = true;
      return;
    }
    pendingFitRef.current = false;
    const { clusters: points, center: fallback } = latest.current;
    const duration = animate && !reducedMotion() ? 600 : 0;
    if (points.length === 0) {
      if (fallback) map.easeTo({ center: [fallback.longitude, fallback.latitude], zoom: DESTINATION_ZOOM, duration });
      return;
    }
    if (points.length === 1) {
      map.easeTo({ center: [points[0].longitude, points[0].latitude], zoom: SINGLE_ZOOM, duration });
      return;
    }
    const bounds = new LngLatBounds();
    for (const c of points) bounds.extend([c.longitude, c.latitude]);
    const p = Math.max(24, Math.min(64, Math.round(Math.min(el.clientWidth, el.clientHeight) / 6)));
    // Folga extra onde ficam os controles (zoom à direita, atribuição embaixo)
    map.fitBounds(bounds, { padding: { top: p, left: p, right: p + 24, bottom: p + 28 }, maxZoom: MAX_FIT_ZOOM, duration });
  });

  // Criação e destruição da instância
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let map: MapLibreMap;
    try {
      configureWorker();
      const start = latest.current.center;
      map = new MapLibreMap({
        container,
        style: config.styleUrl,
        center: start ? [start.longitude, start.latitude] : [0, 20],
        zoom: start ? DESTINATION_ZOOM : 1,
        attributionControl: false,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
      });
    } catch {
      // Sem WebGL (ou contexto recusado): informa fora do ciclo do efeito
      const t = window.setTimeout(() => setStatus({ kind: "error", reason: "webgl" }));
      return () => window.clearTimeout(t);
    }
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();
    // Atribuições exigidas (© OpenMapTiles, © OpenStreetMap) vêm do próprio estilo
    map.addControl(new AttributionControl({ compact: true }), "bottom-right");
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;

    let loaded = false;
    let tileErrors = 0;
    const timer = window.setTimeout(() => {
      if (!loaded) setStatus({ kind: "error", reason: "timeout" });
    }, LOAD_TIMEOUT_MS);
    map.on("load", () => {
      loaded = true;
      window.clearTimeout(timer);
      setStatus({ kind: "ready" });
      // Marcadores e enquadramento dependem da instância pronta
      setMapVersion((v) => v + 1);
    });
    map.on("error", () => {
      if (!loaded) {
        window.clearTimeout(timer);
        setStatus({ kind: "error", reason: "style" });
      } else if (++tileErrors >= TILE_ERROR_THRESHOLD) {
        setTilesFailing(true);
      }
    });
    // Só gestos da pessoa contam como movimento manual (easeTo/fitBounds não têm originalEvent)
    map.on("movestart", (e) => {
      if ((e as { originalEvent?: unknown }).originalEvent) userMovedRef.current = true;
    });

    const markers = markersRef.current;
    return () => {
      window.clearTimeout(timer);
      popupRef.current?.remove();
      popupRef.current = null;
      markers.forEach(({ marker }) => marker.remove());
      markers.clear();
      map.remove();
      mapRef.current = null;
    };
  }, [config.styleUrl, attempt]);

  // Redimensiona com o contêiner
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const map = mapRef.current;
      if (!map || !el.clientWidth || !el.clientHeight) return;
      map.resize();
      if (pendingFitRef.current) fitRef.current(false);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Marcadores
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const markers = markersRef.current;
    popupRef.current?.remove();
    markers.forEach(({ marker }) => marker.remove());
    markers.clear();

    for (const cluster of latest.current.clusters) {
      const el = markerElement(cluster);
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        openPopup(cluster);
      });
      const marker = new Marker({ element: el, anchor: "center" }).setLngLat([cluster.longitude, cluster.latitude]).addTo(map);
      markers.set(cluster.key, { marker, el, cluster });
    }

    function openPopup(cluster: MapCluster) {
      popupRef.current?.remove();
      const height = containerRef.current?.clientHeight ?? 400;
      // Leva o marcador para baixo do centro e abre o balão acima dele, com altura que cabe no mapa
      map!.easeTo({
        center: [cluster.longitude, cluster.latitude],
        offset: [0, Math.round(height * 0.3)],
        duration: reducedMotion() ? 0 : 300,
      });
      const content = popupContent(cluster, latest.current.onSelectActivity);
      content.style.maxHeight = `${Math.max(110, Math.round(height * 0.8) - 70)}px`;
      const popup = new Popup({ offset: 20, anchor: "bottom", maxWidth: "300px", closeButton: true, focusAfterOpen: true })
        .setLngLat([cluster.longitude, cluster.latitude])
        .setDOMContent(content)
        .addTo(map!);
      popupRef.current = popup;
    }
    // Posições, grupos e textos vêm de `latest`; estas chaves dizem quando recriar.
  }, [signature, contentKey, mapVersion]);

  // Enquadramento: troca de dia, pedido explícito, ou pontos/destino alterados sem movimento manual
  const lastFit = useRef({ viewKey: "", signature: "", centerKey: "", fitRequest: 0, mapVersion: 0 });
  useEffect(() => {
    if (!mapRef.current || mapVersion === 0) return;
    const prev = lastFit.current;
    lastFit.current = { viewKey, signature, centerKey, fitRequest, mapVersion };
    const reset = prev.viewKey !== viewKey || prev.mapVersion !== mapVersion;
    if (reset || prev.fitRequest !== fitRequest) {
      userMovedRef.current = false;
      if (reset) popupRef.current?.remove();
      fitRef.current(!reset);
    } else if ((prev.signature !== signature || prev.centerKey !== centerKey) && !userMovedRef.current) {
      fitRef.current(true);
    }
  }, [viewKey, signature, centerKey, fitRequest, mapVersion]);

  // Realce do marcador da atividade destacada
  useEffect(() => {
    for (const { el, cluster } of markersRef.current.values()) {
      el.classList.toggle("ba-marker--active", !!highlightId && cluster.items.some((i) => i.activity.id === highlightId));
    }
  }, [highlightId, signature, contentKey, mapVersion]);

  // Foco pedido pela lista ("Destacar no mapa"): centraliza o marcador uma vez por pedido
  const lastFocusSeq = useRef(0);
  useEffect(() => {
    const map = mapRef.current;
    if (!focus || !map || mapVersion === 0 || focus.seq === lastFocusSeq.current) return;
    const target = latest.current.clusters.find((c) => c.items.some((i) => i.activity.id === focus.id));
    if (!target) return;
    lastFocusSeq.current = focus.seq;
    map.easeTo({
      center: [target.longitude, target.latitude],
      zoom: Math.max(map.getZoom(), 14),
      duration: reducedMotion() ? 0 : 500,
    });
  }, [focus, mapVersion]);

  const retry = () => {
    setStatus({ kind: "loading" });
    setTilesFailing(false);
    setAttempt((a) => a + 1);
  };

  return (
    <div className={cn("relative overflow-hidden rounded-2xl border border-line bg-[#eef0ec]", className)}>
      <div
        ref={containerRef}
        // Inline: o CSS do MapLibre (fora de @layer) define position: relative em .maplibregl-map
        // e venceria as utilidades do Tailwind, deixando o contêiner com altura zero.
        style={{ position: "absolute", inset: 0 }}
        role="region"
        aria-label={`Mapa do dia com ${clusters.length} ${clusters.length === 1 ? "local" : "locais"}`}
      />

      {status.kind === "loading" && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center" role="status">
          <LoaderCircle aria-hidden className="size-6 animate-spin text-forest" />
          <span className="sr-only">Carregando mapa</span>
        </div>
      )}

      {status.kind === "error" && (
        <div role="alert" className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-cream/95 p-6 text-center">
          <MapPinOff aria-hidden className="size-7 text-[#7a5200]" />
          <p className="max-w-[260px] text-sm font-medium text-ink">
            {status.reason === "webgl"
              ? "Este navegador não conseguiu exibir o mapa (WebGL indisponível). A lista de atividades continua completa."
              : "Não foi possível carregar o mapa agora. A lista de atividades continua disponível."}
          </p>
          {status.reason !== "webgl" && (
            <button
              type="button"
              onClick={retry}
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line bg-white px-3.5 text-sm font-semibold text-forest hover:border-forest/40"
            >
              <RefreshCw aria-hidden className="size-4" /> Tentar novamente
            </button>
          )}
        </div>
      )}

      {status.kind === "ready" && tilesFailing && (
        <div role="status" className="absolute inset-x-2 top-2 z-10 flex items-center gap-2 rounded-xl bg-[#fbf2df] px-3 py-2 text-xs text-[#5c430c] shadow-soft">
          <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
          <span className="flex-1">Partes do mapa não carregaram.</span>
          <button type="button" onClick={retry} className="font-semibold underline">
            Tentar novamente
          </button>
        </div>
      )}

      {status.kind === "ready" && clusters.length === 0 && emptyOverlay && (
        <div className="pointer-events-none absolute inset-x-3 bottom-10 z-10 flex justify-center">
          <div className="pointer-events-auto max-w-[300px] rounded-2xl bg-white/95 px-4 py-3 text-center text-sm text-ink shadow-soft">
            {emptyOverlay}
          </div>
        </div>
      )}
    </div>
  );
}

/** Conteúdo exibido nos marcadores/balões (para recriá-los quando título ou horário mudam). */
function clustersContentKey(clusters: MapCluster[]) {
  return clusters
    .map((c) => c.items.map((i) => `${i.number}:${i.activity.category}:${i.activity.time}:${i.activity.title}:${i.activity.place?.formattedAddress ?? ""}`).join(","))
    .join("|");
}

function markerElement(cluster: MapCluster): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  const multiple = cluster.items.length > 1;
  el.className = cn("ba-marker", multiple && "ba-marker--group");
  const first = cluster.items[0];
  el.style.setProperty("--ba-marker-color", multiple ? "#183f36" : categories[first.activity.category].color);
  el.textContent = multiple
    ? cluster.items.length === 2
      ? `${cluster.items[0].number}·${cluster.items[1].number}`
      : `${first.number}+`
    : String(first.number);
  el.setAttribute(
    "aria-label",
    multiple
      ? `Atividades ${cluster.items.map((i) => i.number).join(", ")} no mesmo local: ${cluster.items.map((i) => i.activity.title).join("; ")}`
      : `${first.number}. ${first.activity.title}, ${first.activity.time}`,
  );
  return el;
}

/** Balão do marcador, montado com textContent (nada de HTML vindo dos dados). */
function popupContent(cluster: MapCluster, onSelect?: (id: string) => void): HTMLElement {
  const root = document.createElement("div");
  root.className = "ba-popup";
  if (cluster.items.length > 1) {
    const note = document.createElement("p");
    note.className = "ba-popup__note";
    note.textContent = `${cluster.items.length} atividades neste local`;
    root.append(note);
  }
  for (const { activity: a, number } of cluster.items) {
    const item = document.createElement("div");
    item.className = "ba-popup__item";

    const head = document.createElement("p");
    head.className = "ba-popup__title";
    const badge = document.createElement("span");
    badge.className = "ba-popup__badge";
    badge.style.backgroundColor = categories[a.category].color;
    badge.textContent = String(number);
    const title = document.createElement("span");
    title.textContent = a.title;
    head.append(badge, title);

    const meta = document.createElement("p");
    meta.className = "ba-popup__meta";
    meta.textContent = [a.time, a.durationMin ? formatDuration(a.durationMin) : null].filter(Boolean).join(" · ");

    item.append(head, meta);
    const address = a.place?.formattedAddress ?? a.location;
    if (address) {
      const addr = document.createElement("p");
      addr.className = "ba-popup__address";
      addr.textContent = address;
      item.append(addr);
    }

    const actions = document.createElement("div");
    actions.className = "ba-popup__actions";
    if (a.place) {
      const link = document.createElement("a");
      link.href = googleMapsUrl(a.place);
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "Abrir no Google Maps";
      actions.append(link);
    }
    if (onSelect) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "Ver na lista";
      btn.addEventListener("click", () => onSelect(a.id));
      actions.append(btn);
    }
    item.append(actions);
    root.append(item);
  }
  return root;
}
