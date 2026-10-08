"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarPlus,
  Compass,
  Crown,
  Info,
  ListOrdered,
  Lock,
  Map as MapIcon,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Radio,
  RefreshCw,
  Sparkles,
  TriangleAlert,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { errorMessage, isApiError } from "@/api/client";
import { aiApi, itineraryApi } from "@/api/endpoints";
import { toActivityInput, toDay } from "@/api/mappers";
import { UpgradePanel } from "@/components/billing/upgrade-panel";
import { Button, buttonClasses } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { moveOptions, overlapMap, swapSameTime } from "@/lib/activities";
import { isActiveJob } from "@/lib/ai-options";
import { daysBetween, longDate, longDateTitle, toMinutes } from "@/lib/dates";
import { plural } from "@/lib/format";
import { computeLive } from "@/lib/live";
import { planLabels, roleLabels } from "@/lib/plans";
import { nowInTimeZone, offsetLabel, timeZoneLabel } from "@/lib/time-zones";
import type { Activity, Trip } from "@/lib/types";
import { useClientNow } from "@/lib/use-client-now";
import { useMediaQuery } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import { invalidateTrip, keys, useEntitlements, useMembers, useTripQuery } from "@/state/queries";
import { ActivityCard, TimelineList } from "./activity-card";
import { ActivityModal, type ActivityDraft } from "./activity-modal";
import { AiAssistant } from "./ai-assistant";
import { DaySelector } from "./day-selector";
import { EditTripModal } from "./edit-trip-modal";
import { ExportModal } from "./export-modal";
import { LiveMode, type TripPhase } from "./live-mode";
import { MapPanel } from "./map-panel";
import { ParticipantsModal } from "./participants-modal";
import { ShareModal } from "./share-modal";
import { TripCover } from "./trip-cover";

type Dialog =
  | { kind: "activity"; editing: Activity | null; focusLocation?: boolean }
  | { kind: "ai" }
  | { kind: "share" }
  | { kind: "people" }
  | { kind: "export" }
  | { kind: "trip" }
  | { kind: "plan" }
  | null;

const PANEL_ID = "painel-dia";

export function TripEditor({ tripId }: { tripId: string }) {
  const query = useTripQuery(tripId);
  const entitlements = useEntitlements(tripId);
  const members = useMembers(tripId);
  const qc = useQueryClient();
  const toast = useToast();
  const now = useClientNow();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const [selectedDayId, setSelectedDayId] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<"roteiro" | "mapa">("roteiro");
  const [mapOpen, setMapOpen] = useState(true);
  /** Mapa ampliado em tela cheia: o painel deixa de ser sticky para o overlay não ficar preso */
  const [mapExpanded, setMapExpanded] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  /** Pedido para centralizar o mapa numa atividade ("Destacar no mapa" no card) */
  const [mapFocus, setMapFocus] = useState<{ id: string; seq: number } | null>(null);
  const [liveOn, setLiveOn] = useState(false);
  const [simulated, setSimulated] = useState(false);
  const [simMinutes, setSimMinutes] = useState(17 * 60 + 15);
  /** Atividades com alteração em andamento (botões desabilitados) */
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [paymentCanceled] = useState(() => params.get("pagamento") === "cancelado");
  const [showCanceled, setShowCanceled] = useState(paymentCanceled);
  /** Atividade que deve receber foco e ficar visível depois do próximo render */
  const focusAfterRender = useRef<{ id: string; button: string } | null>(null);

  const ai = entitlements.data?.ai;
  // Reencontra uma geração com IA em andamento ao voltar para a viagem
  const jobs = useQuery({
    queryKey: keys.aiJobs(tripId),
    queryFn: () => aiApi.jobs(tripId),
    enabled: !!ai?.enabled,
    staleTime: 30_000,
  });
  const activeJob = jobs.data?.find(isActiveJob);

  useEffect(() => {
    if (!paymentCanceled) return;
    // Volta do checkout sem pagar: nada muda localmente; o estado real vem do servidor
    void qc.invalidateQueries({ queryKey: keys.entitlements(tripId) });
    router.replace(pathname, { scroll: false });
  }, [paymentCanceled, qc, tripId, router, pathname]);

  useEffect(() => {
    const target = focusAfterRender.current;
    if (!target) return;
    const card = document.getElementById(`atividade-${target.id}`);
    if (!card) return;
    focusAfterRender.current = null;
    card.scrollIntoView({ block: "nearest" });
    const button =
      card.querySelector<HTMLElement>(`button[aria-label^="${target.button}"]:not([disabled])`) ??
      card.querySelector<HTMLElement>('button[aria-label^="Editar"]');
    button?.focus({ preventScroll: true });
  });

  if (query.isPending) return <EditorSkeleton />;
  if (!query.data) {
    if (isApiError(query.error, "TRIP_NOT_FOUND") || isApiError(query.error, "NOT_FOUND")) return <TripNotFound />;
    if (isApiError(query.error, "TRIP_UPGRADE_REQUIRED")) return <AccessSuspended message={query.error.message} />;
    return <EditorError message={errorMessage(query.error)} onRetry={() => void query.refetch()} retrying={query.isFetching} />;
  }

  const trip: Trip = query.data;
  const ent = entitlements.data;
  const canEdit = trip.role !== "VIEWER";
  const isOwner = trip.role === "OWNER";
  const ownerName = members.data?.find((m) => m.role === "OWNER")?.name;
  const day = trip.days.find((d) => d.id === selectedDayId) ?? trip.days[0];
  if (!day) return <EditorError message="Esta viagem ainda não tem dias." onRetry={() => void query.refetch()} retrying={false} />;
  const activities = day.activities;
  const overlaps = overlapMap(activities);
  const limit = ent?.maxActivitiesPerDay ?? null;

  // "Durante a viagem": data e hora no fuso do destino, ou simulação no dia selecionado
  const real = now ? nowInTimeZone(trip.timeZone, now) : null;
  const realPhase: TripPhase = !real ? "unknown" : real.date < trip.startDate ? "before" : real.date > trip.endDate ? "after" : "during";
  const realDay = real ? (trip.days.find((d) => d.date === real.date) ?? null) : null;
  const liveDay = liveOn ? (simulated ? day : realDay) : null;
  const liveMinutes = simulated ? simMinutes : (real?.minutes ?? null);
  const live = liveDay && liveMinutes !== null ? computeLive(liveDay.activities, liveMinutes) : null;
  const cardStates = live && liveDay?.id === day.id ? live.states : null;

  const refresh = () => invalidateTrip(qc, trip.id);
  const mark = (id: string, on: boolean) =>
    setPending((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  function selectDay(id: string) {
    setSelectedDayId(id);
    setHighlightId(null);
    // Se a lista já foi rolada, volta para o início do dia (abaixo da faixa fixa)
    const panel = document.getElementById(PANEL_ID);
    if (panel && panel.getBoundingClientRect().top < 140) panel.scrollIntoView({ block: "start" });
  }

  /** Cria ou edita no servidor; erros sobem para o formulário, que preserva o rascunho. */
  async function submitActivity(draft: ActivityDraft, version?: number) {
    if (dialog?.kind !== "activity") return;
    const editing = dialog.editing;
    const input = toActivityInput(draft);
    const result =
      editing && version !== undefined
        ? await itineraryApi.updateActivity(trip.id, editing.id, {
            ...input,
            version,
            ...(draft.dayId !== editing.dayId ? { dayId: draft.dayId } : {}),
          })
        : await itineraryApi.createActivity(trip.id, draft.dayId, input);
    await refresh();
    const saved = result.activity;
    const targetIndex = trip.days.findIndex((d) => d.id === saved.dayId);
    const movedDay = editing && editing.dayId !== saved.dayId;
    const movedTime = editing && editing.time !== saved.time;
    toast.show(
      !editing
        ? "Atividade adicionada"
        : movedDay
          ? `Alterações salvas · atividade movida para o Dia ${targetIndex + 1}`
          : movedTime
            ? `Alterações salvas · atividade movida para ${saved.time}`
            : "Alterações salvas",
    );
    setSelectedDayId(saved.dayId);
    focusAfterRender.current = { id: saved.id, button: "Editar" };
    setHighlightId(saved.id);
    setDialog(null);
  }

  async function deleteActivity(activity: Activity) {
    const index = activities.findIndex((a) => a.id === activity.id);
    mark(activity.id, true);
    try {
      await itineraryApi.deleteActivity(trip.id, activity.id, activity.version);
      await refresh();
    } catch (e) {
      mark(activity.id, false);
      await refresh();
      toast.show(
        isApiError(e, "VERSION_CONFLICT")
          ? "Esta atividade foi alterada por outra pessoa. Confira a versão atual antes de excluir."
          : isApiError(e, "ACTIVITY_NOT_FOUND")
            ? "Esta atividade já tinha sido excluída."
            : errorMessage(e, "Não foi possível excluir a atividade."),
        { tone: isApiError(e, "ACTIVITY_NOT_FOUND") ? "info" : "error" },
      );
      return;
    }
    mark(activity.id, false);
    if (highlightId === activity.id) setHighlightId(null);
    // Devolve o foco para a atividade vizinha (ou para o botão de adicionar)
    const neighbor = activities[index + 1] ?? activities[index - 1];
    window.setTimeout(() => {
      const target = neighbor
        ? document.querySelector<HTMLElement>(`#atividade-${neighbor.id} button[aria-label^="Editar"]`)
        : document.querySelector<HTMLElement>(`#${PANEL_ID} [data-add-activity]`);
      target?.focus();
    });
    toast.show(`“${activity.title}” excluída`, {
      tone: "info",
      action: {
        label: "Desfazer",
        onClick: () => {
          // Recria com o mesmo conteúdo (o servidor confere o limite do plano de novo)
          itineraryApi.createActivity(trip.id, activity.dayId, toActivityInput(activity)).then(
            async (r) => {
              await refresh();
              focusAfterRender.current = { id: r.activity.id, button: "Editar" };
              toast.show("Atividade restaurada");
            },
            (e) =>
              toast.show(
                isApiError(e, "DAILY_ACTIVITY_LIMIT_REACHED")
                  ? "Não deu para restaurar: o dia atingiu o limite do plano."
                  : errorMessage(e, "Não foi possível restaurar a atividade."),
                { tone: "error" },
              ),
          );
        },
      },
    });
  }

  async function moveActivity(index: number, direction: -1 | 1) {
    const id = activities[index].id;
    const next = swapSameTime(activities, index, direction);
    mark(id, true);
    try {
      const updated = await itineraryApi.reorder(trip.id, day.id, next.map((a) => ({ id: a.id, version: a.version })));
      qc.setQueryData<Trip>(keys.trip(trip.id), (t) =>
        t ? { ...t, days: t.days.map((d) => (d.id === updated.id ? toDay(updated) : d)) } : t,
      );
      focusAfterRender.current = { id, button: "Mover" };
      void refresh();
    } catch (e) {
      await refresh();
      toast.show(
        isApiError(e, "VERSION_CONFLICT") || isApiError(e, "INVALID_REORDER")
          ? "O roteiro mudou enquanto você reordenava. Atualizamos a lista; confira e tente de novo."
          : errorMessage(e, "Não foi possível reordenar."),
        { tone: "error" },
      );
    }
    mark(id, false);
  }

  function focusActivity(id: string) {
    setHighlightId(id);
    if (liveDay && liveDay.id !== day.id) setSelectedDayId(liveDay.id);
    if (mobileView === "mapa" && window.matchMedia("(max-width: 1023px)").matches) setMobileView("roteiro");
    focusAfterRender.current = { id, button: "Editar" };
  }

  function toggleLive() {
    if (liveOn) {
      setLiveOn(false);
      return;
    }
    setLiveOn(true);
    if (realPhase === "during" && realDay) {
      setSimulated(false);
      selectDay(realDay.id);
    } else {
      // Fora das datas da viagem, o modo começa simulando um horário no dia selecionado
      setSimulated(true);
      const first = activities.find((a) => a.durationMin) ?? activities[0];
      if (first) setSimMinutes(Math.min(23 * 60 + 45, Math.floor(toMinutes(first.time) / 15) * 15 + 15));
    }
  }

  const upgrade = (reason: React.ReactNode) =>
    ent ? <UpgradePanel tripId={trip.id} entitlements={ent} ownerName={ownerName} reason={reason} /> : null;

  return (
    <main className={cn("mx-auto w-full max-w-6xl flex-1 px-4 pt-4 sm:px-6 sm:pt-6 lg:pb-16", canEdit ? "pb-28" : "pb-16")}>
      {showCanceled && (
        <div role="status" className="mb-4 flex items-start gap-3 rounded-2xl border border-line bg-white px-4 py-3 text-sm">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-forest" />
          <p className="flex-1">
            Pagamento não concluído. Nada foi cobrado por este checkout e o plano continua{" "}
            {ent ? planLabels[ent.plan] : "o mesmo"}. Você pode tentar de novo quando quiser.
          </p>
          <button type="button" onClick={() => setShowCanceled(false)} aria-label="Fechar aviso" className="rounded-full p-1 text-ink-soft hover:bg-forest/5">
            <X aria-hidden className="size-4" />
          </button>
        </div>
      )}
      {query.isError && (
        <p role="status" className="mb-4 flex items-center gap-2 rounded-2xl bg-[#fbf2df] px-4 py-2.5 text-sm text-[#5c430c]">
          <TriangleAlert aria-hidden className="size-4 shrink-0" />
          <span className="flex-1">Não conseguimos atualizar o roteiro. Você está vendo a última versão carregada.</span>
          <button type="button" className="font-semibold underline" onClick={() => void query.refetch()}>
            Tentar de novo
          </button>
        </p>
      )}

      <TripCover
        trip={trip}
        people={members.data}
        onPeople={() => setDialog({ kind: "people" })}
        onShare={isOwner ? () => setDialog({ kind: "share" }) : undefined}
        onExport={() => setDialog({ kind: "export" })}
        onEdit={isOwner ? () => setDialog({ kind: "trip" }) : undefined}
      />

      {/* Ações principais */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {canEdit && (
          <Button variant="coral" onClick={() => setDialog({ kind: "ai" })}>
            <Sparkles aria-hidden className="size-4" /> Me ajuda a planejar
          </Button>
        )}
        <button
          type="button"
          onClick={toggleLive}
          aria-pressed={liveOn}
          className={cn(
            "inline-flex h-11 items-center gap-2 rounded-full border px-4 text-[15px] font-semibold transition",
            liveOn ? "border-forest bg-forest text-cream" : "border-line bg-white text-forest hover:border-forest/40",
          )}
        >
          <Radio aria-hidden className="size-4" /> Durante a viagem
        </button>
        <button
          type="button"
          onClick={() => setDialog({ kind: "plan" })}
          className="inline-flex h-11 items-center gap-2 rounded-full border border-line bg-white px-4 text-sm font-semibold text-forest transition hover:border-forest/40 sm:ml-auto"
        >
          <Crown aria-hidden className="size-4 text-coral-700" />
          {ent ? `Plano ${planLabels[ent.plan]}` : "Plano"}
          {limit !== null && (
            <span className="font-medium text-ink-soft">
              · {Math.min(activities.length, limit)} de {limit} atividades
            </span>
          )}
        </button>
        {!canEdit && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-cream-200 px-3 py-1.5 text-xs font-semibold text-ink-soft">
            <Lock aria-hidden className="size-3.5" /> {roleLabels.VIEWER}: somente leitura
          </span>
        )}
      </div>

      {activeJob && dialog?.kind !== "ai" && (
        <button
          type="button"
          onClick={() => setDialog({ kind: "ai" })}
          className="mt-3 flex w-full items-center gap-2 rounded-2xl border border-coral/40 bg-coral-100/50 px-4 py-2.5 text-left text-sm"
        >
          <Sparkles aria-hidden className="size-4 animate-pulse text-coral-700" />
          <span className="flex-1">Uma geração com IA está em andamento nesta viagem.</span>
          <span className="font-semibold text-forest">Acompanhar</span>
        </button>
      )}

      {/* Faixa de dias fixa abaixo do header durante a rolagem */}
      <div className="sticky top-16 z-30 -mx-4 mt-3 border-b border-line/80 bg-cream/95 px-4 py-1.5 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex items-center gap-2">
          <DaySelector
            days={trip.days}
            selectedId={day.id}
            onSelect={selectDay}
            panelId={PANEL_ID}
            liveDayId={liveOn ? (liveDay?.id ?? null) : null}
          />
          <button
            type="button"
            onClick={() => setMobileView((v) => (v === "roteiro" ? "mapa" : "roteiro"))}
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl border border-line bg-white px-3 text-sm font-semibold text-forest lg:hidden"
          >
            {mobileView === "roteiro" ? (
              <>
                <MapIcon aria-hidden className="size-4" /> Mapa
              </>
            ) : (
              <>
                <ListOrdered aria-hidden className="size-4" /> Roteiro
              </>
            )}
            <span className="sr-only"> do dia</span>
          </button>
        </div>
      </div>

      <div className={cn("mt-5 grid gap-8", mapOpen ? "lg:grid-cols-[minmax(0,1fr)_360px]" : "lg:grid-cols-[minmax(0,1fr)_56px]")}>
        {/* Linha do tempo */}
        <section
          id={PANEL_ID}
          role="tabpanel"
          aria-labelledby={`aba-${day.id}`}
          className={cn("min-w-0 scroll-mt-36", mobileView === "mapa" && "hidden lg:block")}
        >
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-display text-2xl font-bold tracking-tight text-forest sm:text-3xl">{longDateTitle(day.date)}</h2>
              <p className="text-sm text-ink-soft">
                {day.title ? `${day.title} · ` : ""}
                {activities.length === 0 ? "Nenhuma atividade" : plural(activities.length, "atividade", "atividades")}
                {activities.length > 1 && " · em ordem de horário"}
              </p>
            </div>
            {canEdit && activities.length > 0 && (
              <div className="hidden lg:block">
                <Button size="sm" onClick={() => setDialog({ kind: "activity", editing: null })}>
                  <Plus aria-hidden className="size-4" /> Adicionar atividade
                </Button>
              </div>
            )}
          </div>

          {canEdit && !day.canAddActivities && (
            <p className="mt-3 flex items-start gap-2 rounded-xl bg-[#fbf2df] px-3 py-2 text-sm text-[#5c430c]">
              <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span>
                Este dia chegou ao limite do plano {ent ? planLabels[ent.plan] : "atual"}
                {limit !== null ? ` (${limit} atividades)` : ""}. Você ainda pode editar e excluir.{" "}
                <button type="button" className="font-semibold underline" onClick={() => setDialog({ kind: "plan" })}>
                  Ver planos
                </button>
              </span>
            </p>
          )}

          {liveOn && (
            <div className="mt-4">
              <LiveMode
                destination={trip.destination}
                dayLabel={liveDay ? `Dia ${trip.days.indexOf(liveDay) + 1} · ${longDate(liveDay.date)}` : null}
                info={live}
                minutes={liveMinutes}
                offset={now ? offsetLabel(trip.timeZone, now) : trip.timeZone}
                phase={realPhase}
                daysToStart={real ? daysBetween(real.date, trip.startDate) : null}
                simulated={simulated}
                onSimulatedChange={setSimulated}
                simMinutes={simMinutes}
                onSimMinutesChange={setSimMinutes}
                onFocus={focusActivity}
              />
            </div>
          )}

          {activities.length === 0 ? (
            <EmptyDay
              canEdit={canEdit}
              onAdd={() => setDialog({ kind: "activity", editing: null })}
              onAi={() => setDialog({ kind: "ai" })}
            />
          ) : (
            <div className="mt-4">
              <TimelineList>
                {activities.map((a, i) => {
                  const move = moveOptions(activities, i);
                  return (
                    <ActivityCard
                      key={a.id}
                      activity={a}
                      overlap={overlaps[a.id]}
                      live={cardStates ? cardStates[a.id] : null}
                      highlighted={highlightId === a.id}
                      readOnly={!canEdit}
                      busy={pending.size > 0}
                      canMoveUp={move.up}
                      canMoveDown={move.down}
                      onEdit={() => setDialog({ kind: "activity", editing: a })}
                      onDelete={() => void deleteActivity(a)}
                      onMove={(dir) => void moveActivity(i, dir)}
                      onFocusPoint={
                        a.place
                          ? () => {
                              setHighlightId(a.id);
                              setMapFocus({ id: a.id, seq: Date.now() });
                              if (!isDesktop) setMobileView("mapa");
                              else setMapOpen(true);
                            }
                          : undefined
                      }
                      onSetLocation={
                        canEdit && !a.place && a.location
                          ? () => setDialog({ kind: "activity", editing: a, focusLocation: true })
                          : undefined
                      }
                    />
                  );
                })}
              </TimelineList>
              {canEdit && (
                <button
                  type="button"
                  data-add-activity
                  onClick={() => setDialog({ kind: "activity", editing: null })}
                  className="ml-[68px] mt-3 flex min-h-11 w-[calc(100%-68px)] items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line text-sm font-semibold text-forest transition hover:border-forest/40 hover:bg-white sm:ml-[80px] sm:w-[calc(100%-80px)]"
                >
                  <Plus aria-hidden className="size-4" /> Adicionar atividade
                </button>
              )}
            </div>
          )}

          <p className="mt-6 text-xs text-ink-soft">Horários no fuso do destino: {timeZoneLabel(trip.timeZone)}.</p>
        </section>

        {/* Mapa: painel lateral no desktop, alternância no celular */}
        <aside aria-label="Mapa do dia" className={cn("min-w-0", mobileView === "roteiro" && "hidden lg:block")}>
          <div className={cn(!mapExpanded && "lg:sticky lg:top-36 lg:max-h-[calc(100svh-10rem)] lg:overflow-y-auto")}>
            <div className={cn("mb-3 hidden items-center justify-between", mapOpen && "lg:flex")}>
              <h2 className="font-display text-lg font-bold text-forest">Mapa do dia</h2>
              <button
                type="button"
                onClick={() => setMapOpen(false)}
                aria-expanded
                aria-controls="painel-mapa"
                aria-label="Recolher mapa"
                title="Recolher mapa"
                className="inline-flex size-10 items-center justify-center rounded-full border border-line bg-white text-forest hover:border-forest/40"
              >
                <PanelRightClose aria-hidden className="size-5" />
              </button>
            </div>
            <div id="painel-mapa" className={cn(!mapOpen && "lg:hidden")}>
              <MapPanel
                dayId={day.id}
                activities={activities}
                destination={trip.destinationPlace}
                highlightId={highlightId}
                focus={mapFocus}
                onSelect={setHighlightId}
                onShowInList={focusActivity}
                onSetLocation={canEdit ? (a) => setDialog({ kind: "activity", editing: a, focusLocation: true }) : undefined}
                destinationEditor={isOwner ? { tripId: trip.id, destinationText: trip.destination } : undefined}
                active={isDesktop ? mapOpen : mobileView === "mapa"}
                onExpandedChange={setMapExpanded}
              />
            </div>
            {!mapOpen && (
              <button
                type="button"
                onClick={() => setMapOpen(true)}
                className="hidden w-10 flex-col items-center gap-2 rounded-full border border-line bg-white py-4 text-xs font-semibold text-forest hover:border-forest/40 lg:flex"
                aria-expanded={false}
                aria-controls="painel-mapa"
                aria-label="Expandir mapa"
                title="Expandir mapa"
              >
                <PanelRightOpen aria-hidden className="size-4" />
                <span className="[writing-mode:vertical-rl]">Mapa</span>
              </button>
            )}
          </div>
        </aside>
      </div>

      {/* Ações fixas no celular (o conteúdo tem espaço inferior para não ficar coberto) */}
      {canEdit && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-cream/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur lg:hidden">
          <div className="mx-auto flex max-w-md gap-2">
            <Button className="flex-1" onClick={() => setDialog({ kind: "activity", editing: null })}>
              <Plus aria-hidden className="size-4" /> Atividade
            </Button>
            <Button variant="coral" className="flex-1" onClick={() => setDialog({ kind: "ai" })}>
              <Sparkles aria-hidden className="size-4" /> Sugestões
            </Button>
          </div>
        </div>
      )}

      <ActivityModal
        open={dialog?.kind === "activity"}
        tripId={trip.id}
        focusLocation={dialog?.kind === "activity" && !!dialog.focusLocation}
        initial={dialog?.kind === "activity" ? dialog.editing : null}
        dayId={day.id}
        days={trip.days}
        limitPerDay={limit}
        onClose={() => setDialog(null)}
        onSubmit={submitActivity}
        onStale={() => void refresh()}
        renderUpgrade={upgrade}
      />
      <AiAssistant
        open={dialog?.kind === "ai"}
        onClose={() => {
          setDialog(null);
          void qc.invalidateQueries({ queryKey: keys.aiJobs(trip.id) });
        }}
        trip={trip}
        dayId={day.id}
        entitlements={ent}
        ownerName={ownerName}
      />
      <ShareModal open={dialog?.kind === "share"} onClose={() => setDialog(null)} trip={trip} entitlements={ent} />
      <ParticipantsModal open={dialog?.kind === "people"} onClose={() => setDialog(null)} trip={trip} entitlements={ent} />
      <ExportModal open={dialog?.kind === "export"} onClose={() => setDialog(null)} trip={trip} initialDayId={day.id} />
      {isOwner && <EditTripModal open={dialog?.kind === "trip"} trip={trip} onClose={() => setDialog(null)} />}
      <Modal open={dialog?.kind === "plan"} onClose={() => setDialog(null)} title="Plano da viagem" description="Pagamento único por viagem, sem assinatura.">
        <PlanSummary trip={trip} dayActivities={activities.length} ownerName={ownerName} upgrade={upgrade} />
      </Modal>
    </main>
  );
}

function PlanSummary({
  trip,
  dayActivities,
  ownerName,
  upgrade,
}: {
  trip: Trip;
  dayActivities: number;
  ownerName?: string;
  upgrade: (reason: React.ReactNode) => React.ReactNode;
}) {
  const { data: ent, isError, error } = useEntitlements(trip.id);
  if (isError && !ent) return <p role="alert" className="text-sm text-[#9b2c1a]">{errorMessage(error)}</p>;
  if (!ent) return <p className="text-sm text-ink-soft">Carregando plano…</p>;
  const items = [
    ent.maxActivitiesPerDay === null ? "Atividades ilimitadas por dia" : `Até ${ent.maxActivitiesPerDay} atividades por dia`,
    ent.collaboration ? "Convidar pessoas para editar ou ver" : "Sem convidados",
    ent.publicSharing ? "Link público somente leitura" : "Sem link público",
    ent.ai.enabled ? "Sugestões e ajustes com IA (uso limitado por viagem)" : "Sem IA",
    "Exportação em PNG e PDF",
  ];
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-line bg-white p-4">
        <p className="font-display text-xl font-bold text-forest">Plano {planLabels[ent.plan]}</p>
        {ent.maxActivitiesPerDay !== null && (
          <p className="mt-1 text-sm text-ink">
            Neste dia: {Math.min(dayActivities, ent.maxActivitiesPerDay)} de {ent.maxActivitiesPerDay} atividades
          </p>
        )}
        <ul className="mt-3 space-y-1 text-sm text-ink-soft">
          {items.map((i) => (
            <li key={i}>• {i}</li>
          ))}
        </ul>
      </div>
      {ent.availableUpgrades.length > 0 || ent.hasPendingOrder
        ? upgrade(ent.canPurchase ? undefined : `Plano atual definido por ${ownerName ?? "quem criou a viagem"}.`)
        : <p className="text-sm text-ink-soft">Esta viagem já tem todos os recursos disponíveis.</p>}
    </div>
  );
}

function EmptyDay({ canEdit, onAdd, onAi }: { canEdit: boolean; onAdd: () => void; onAi: () => void }) {
  return (
    <div className="mt-5 flex flex-col items-center rounded-[28px] border-2 border-dashed border-line bg-white/60 px-6 py-12 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-coral-100 text-coral-700">
        <CalendarPlus aria-hidden className="size-7" />
      </span>
      <h3 className="mt-4 font-display text-2xl font-bold text-forest">Dia livre, por enquanto</h3>
      <p className="mt-2 max-w-sm text-ink-soft">
        {canEdit
          ? "Adicione a primeira atividade ou peça sugestões para montar o dia em poucos cliques."
          : "Nada foi planejado para este dia ainda."}
      </p>
      {canEdit && (
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button onClick={onAdd} data-add-activity>
            <Plus aria-hidden className="size-4" /> Adicionar atividade
          </Button>
          <Button variant="coral" onClick={onAi}>
            <Sparkles aria-hidden className="size-4" /> Me ajuda a planejar
          </Button>
        </div>
      )}
    </div>
  );
}

export function EditorSkeleton() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-4 sm:px-6 sm:pt-6" aria-busy="true" aria-label="Carregando roteiro">
      <div className="h-[200px] animate-pulse rounded-[28px] bg-sand/70 sm:h-[220px]" />
      <div className="mt-5 flex gap-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-12 w-[68px] animate-pulse rounded-xl bg-sand/60" />
        ))}
      </div>
      <div className="mt-8 space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="ml-16 h-20 animate-pulse rounded-2xl bg-sand/50" />
        ))}
      </div>
    </main>
  );
}

function EditorError({ message, onRetry, retrying }: { message: string; onRetry: () => void; retrying: boolean }) {
  return (
    <main role="alert" className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-6 py-24 text-center">
      <TriangleAlert aria-hidden className="size-8 text-[#7a5200]" />
      <h1 className="mt-4 font-display text-3xl font-bold text-forest">Não conseguimos abrir o roteiro</h1>
      <p className="mt-2 text-ink-soft">{message}</p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Button variant="secondary" onClick={onRetry} disabled={retrying}>
          <RefreshCw aria-hidden className={retrying ? "size-4 animate-spin" : "size-4"} /> Tentar novamente
        </Button>
        <Link href="/app" className={buttonClasses("primary", "md")}>
          Ver minhas viagens
        </Link>
      </div>
    </main>
  );
}

function TripNotFound() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-6 py-24 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-forest-100 text-forest">
        <Compass aria-hidden className="size-7" />
      </span>
      <h1 className="mt-4 font-display text-3xl font-bold text-forest">Viagem não encontrada</h1>
      <p className="mt-2 text-ink-soft">Ela não existe, foi excluída ou você não participa dela.</p>
      <Link href="/app" className={buttonClasses("primary", "md", "mt-6")}>
        Ver minhas viagens
      </Link>
    </main>
  );
}

function AccessSuspended({ message }: { message: string }) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-6 py-24 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-[#fbf2df] text-[#7a5200]">
        <Lock aria-hidden className="size-7" />
      </span>
      <h1 className="mt-4 font-display text-3xl font-bold text-forest">Acesso suspenso</h1>
      <p className="mt-2 text-ink-soft">{message} Fale com quem criou a viagem.</p>
      <Link href="/app" className={buttonClasses("primary", "md", "mt-6")}>
        Ver minhas viagens
      </Link>
    </main>
  );
}
