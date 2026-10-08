"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Clock, LoaderCircle, Lock, RefreshCw, RotateCcw, Sparkles, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ApiError, errorMessage, isApiError } from "@/api/client";
import type { AiEntitlementDto, AiJobDto, AiKind, Budget, EntitlementsDto, Pace } from "@/api/contracts";
import { aiApi } from "@/api/endpoints";
import { UpgradePanel } from "@/components/billing/upgrade-panel";
import { Button } from "@/components/ui/button";
import { inputClasses } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { budgetLabels, interestOptions, isActiveJob, jobFailureCopy, kindLabels, paceLabels } from "@/lib/ai-options";
import { longDate } from "@/lib/dates";
import { plural } from "@/lib/format";
import type { Trip } from "@/lib/types";
import { cn } from "@/lib/utils";
import { keys, useAiUsage, useRefreshTrip } from "@/state/queries";
import { AdjustmentsReview, SuggestionsReview } from "./ai-review";

const POLL_MS = 1500;
/** ~2 minutos de acompanhamento automático; depois, consulta manual */
const MAX_POLLS = 80;
const PROMPT_MAX = 500;

interface AiAssistantProps {
  open: boolean;
  onClose: () => void;
  trip: Trip;
  dayId: string;
  entitlements: EntitlementsDto | undefined;
  ownerName?: string;
}

export function AiAssistant(props: AiAssistantProps) {
  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      variant="drawer"
      title={
        <span className="inline-flex items-center gap-2">
          <Sparkles aria-hidden className="size-5 text-coral-700" /> Me ajuda a planejar
        </span>
      }
      description="Sugestões da IA para revisar antes de entrar no roteiro."
    >
      <AssistantBody {...props} />
    </Modal>
  );
}

function AssistantBody({ trip, dayId, entitlements, ownerName }: AiAssistantProps) {
  const usage = useAiUsage(trip.id, true);
  const [jobId, setJobId] = useState<string | null>(null);
  const [resumeChecked, setResumeChecked] = useState(false);
  const [lastDone, setLastDone] = useState<AiJobDto | null>(null);

  // Reencontra um trabalho em andamento (ou o último concluído) ao abrir o painel
  useEffect(() => {
    let cancelled = false;
    aiApi
      .jobs(trip.id)
      .then((jobs) => {
        if (cancelled) return;
        const active = jobs.find(isActiveJob);
        if (active) setJobId(active.id);
        else setLastDone(jobs.find((j) => j.status === "SUCCEEDED") ?? null);
      })
      .catch(() => undefined)
      .finally(() => !cancelled && setResumeChecked(true));
    return () => {
      cancelled = true;
    };
  }, [trip.id]);

  if (usage.isPending || !resumeChecked) {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-ink-soft">
        <LoaderCircle aria-hidden className="size-4 animate-spin text-forest" /> Verificando a IA desta viagem…
      </p>
    );
  }
  if (usage.isError) {
    if (isApiError(usage.error, "TRIP_UPGRADE_REQUIRED") || isApiError(usage.error, "FORBIDDEN")) {
      return <Blocked title="IA indisponível para você nesta viagem">{usage.error.message}</Blocked>;
    }
    return (
      <Blocked title="Não foi possível verificar a IA">
        {errorMessage(usage.error)}
        <Button variant="secondary" size="sm" className="mt-3" onClick={() => void usage.refetch()}>
          <RefreshCw aria-hidden className="size-4" /> Tentar novamente
        </Button>
      </Blocked>
    );
  }

  const ai = usage.data;
  if (jobId) return <JobTracker trip={trip} jobId={jobId} onBack={() => setJobId(null)} entitlements={entitlements} ownerName={ownerName} />;

  if (!ai.enabled) {
    return entitlements ? (
      <UpgradePanel
        tripId={trip.id}
        entitlements={entitlements}
        ownerName={ownerName}
        only={["PRO_AI"]}
        reason="Sugestões e ajustes com IA fazem parte do plano PRO + IA, com uso limitado por viagem."
      />
    ) : null;
  }
  if (!ai.available) {
    return (
      <Blocked title={ai.unavailableReason === "AI_BUDGET_EXHAUSTED" ? "O uso de IA desta viagem chegou ao limite" : "IA indisponível no momento"}>
        {ai.unavailableReason === "AI_BUDGET_EXHAUSTED"
          ? "Não é possível fazer novas gerações nesta viagem. O roteiro continua editável normalmente."
          : "A geração com IA não está disponível agora. Tente mais tarde."}
      </Blocked>
    );
  }
  if (!ai.canRequest) {
    return <Blocked title="Somente leitura">Quem pode ver o roteiro não pede sugestões. Peça a quem organiza a viagem.</Blocked>;
  }

  return (
    <div className="space-y-5">
      {lastDone && (
        <button
          type="button"
          onClick={() => setJobId(lastDone.id)}
          className="flex w-full items-center gap-2 rounded-2xl border border-line bg-white px-4 py-3 text-left text-sm hover:border-forest/40"
        >
          <Clock aria-hidden className="size-4 text-ink-soft" />
          <span className="flex-1">
            Rever a última geração ({kindLabels[lastDone.kind].usage.toLowerCase()})
          </span>
          <span className="font-semibold text-forest">Abrir</span>
        </button>
      )}
      <RequestForm trip={trip} dayId={dayId} ai={ai} onStarted={setJobId} />
    </div>
  );
}

function Blocked({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div role="status" className="rounded-2xl border border-line bg-white p-5">
      <p className="flex items-center gap-2 font-display text-lg font-bold text-forest">
        <Lock aria-hidden className="size-4" /> {title}
      </p>
      <div className="mt-1 text-sm text-ink-soft">{children}</div>
    </div>
  );
}

/* ───────────────────────────── Pedido ───────────────────────────── */

function UsageLine({ ai, kind }: { ai: AiEntitlementDto; kind: AiKind }) {
  const u = ai.usage[kind];
  return (
    <p className={cn("text-xs", u.remaining === 0 ? "font-semibold text-[#9b2c1a]" : "text-ink-soft")}>
      {u.remaining === 0
        ? `Você já usou todos os ${u.limit} pedidos deste tipo nesta viagem.`
        : `${kindLabels[kind].usage}: ${plural(u.remaining, "pedido disponível", "pedidos disponíveis")} de ${u.limit} nesta viagem.`}
      {u.reserved > 0 && " Há um pedido em andamento."}
    </p>
  );
}

interface PendingRequest {
  kind: AiKind;
  body: unknown;
  key: string;
}

function RequestForm({ trip, dayId, ai, onStarted }: { trip: Trip; dayId: string; ai: AiEntitlementDto; onStarted: (id: string) => void }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<AiKind>("DAY_SUGGESTIONS");
  const [interests, setInterests] = useState<string[]>([]);
  const [pace, setPace] = useState<Pace>("equilibrado");
  const [budget, setBudget] = useState<Budget>("moderado");
  const [prompt, setPrompt] = useState("");
  const [instruction, setInstruction] = useState("");
  const [targetDay, setTargetDay] = useState(dayId);
  const [dayIds, setDayIds] = useState<string[]>(() => trip.days.slice(0, 7).map((d) => d.id));
  const [adjustDays, setAdjustDays] = useState<string[]>([dayId]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Última solicitação enviada: um retry da mesma operação reutiliza a chave de idempotência */
  const [failed, setFailed] = useState<PendingRequest | null>(null);

  const remaining = ai.usage[kind].remaining;
  const text = kind === "ADJUST_ITINERARY" ? instruction : prompt;

  function buildBody(): unknown {
    const prefs = { interests: interests.length ? interests : undefined, pace, budget, prompt: prompt.trim() || undefined };
    if (kind === "DAY_SUGGESTIONS") return { ...prefs, dayId: targetDay };
    if (kind === "TRIP_SUGGESTIONS") return { ...prefs, dayIds };
    return { instruction: instruction.trim(), dayIds: adjustDays };
  }

  async function send(req: PendingRequest) {
    setBusy(true);
    setError(null);
    try {
      const job =
        req.kind === "DAY_SUGGESTIONS"
          ? await aiApi.daySuggestions(trip.id, req.body as never, req.key)
          : req.kind === "TRIP_SUGGESTIONS"
            ? await aiApi.tripSuggestions(trip.id, req.body as never, req.key)
            : await aiApi.adjustments(trip.id, req.body as never, req.key);
      setFailed(null);
      void qc.invalidateQueries({ queryKey: keys.aiUsage(trip.id) });
      onStarted(job.id);
      return;
    } catch (e) {
      if (isApiError(e, "AI_JOB_IN_PROGRESS")) {
        // Já existe uma geração nesta viagem: acompanha a que está rodando
        const active = (await aiApi.jobs(trip.id).catch(() => [])).find(isActiveJob);
        if (active) {
          onStarted(active.id);
          return;
        }
        setError("Já existe uma geração em andamento nesta viagem. Aguarde ela terminar.");
      } else if (isApiError(e, "AI_USAGE_LIMIT_REACHED")) {
        setError("Você já usou todos os pedidos deste tipo nesta viagem.");
      } else if (isApiError(e, "AI_BUDGET_EXHAUSTED")) {
        setError("O uso de IA desta viagem chegou ao limite.");
      } else if (isApiError(e, "AI_UNAVAILABLE")) {
        setError("A geração com IA está indisponível no momento. Tente mais tarde.");
      } else if (isApiError(e, "AI_REQUEST_TOO_LARGE")) {
        setError(`O pedido pode ter até ${e.details.maxChars ?? PROMPT_MAX} caracteres.`);
      } else if (isApiError(e, "AI_TOO_MANY_DAYS")) {
        setError(`Cada geração pode abranger até ${e.details.maxDays ?? 7} dias. Desmarque alguns.`);
      } else if (e instanceof ApiError && e.status < 500) {
        setError(e.message);
      } else {
        // Falha de rede ou do servidor: o retry usa a mesma chave (não duplica o pedido)
        setFailed(req);
        setError(`${errorMessage(e)} Seu pedido não foi perdido.`);
      }
      void qc.invalidateQueries({ queryKey: keys.aiUsage(trip.id) });
    }
    setBusy(false);
  }

  function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (busy) return;
    if (kind === "ADJUST_ITINERARY" && !instruction.trim()) {
      setError("Descreva o ajuste que você quer.");
      return;
    }
    if (kind === "TRIP_SUGGESTIONS" && dayIds.length === 0) {
      setError("Escolha pelo menos um dia.");
      return;
    }
    void send({ kind, body: buildBody(), key: crypto.randomUUID() });
  }

  const dayChecks = (value: string[], set: (v: string[]) => void, legend: string) => (
    <fieldset>
      <legend className="text-sm font-semibold text-ink">{legend}</legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {trip.days.map((d, i) => {
          const checked = value.includes(d.id);
          return (
            <label
              key={d.id}
              className={cn(
                "inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-forest",
                checked ? "border-forest bg-forest text-cream" : "border-line bg-white text-ink hover:border-forest/40",
              )}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={checked}
                onChange={() => set(checked ? value.filter((x) => x !== d.id) : [...value, d.id])}
              />
              {checked && <Check aria-hidden className="size-3.5" />}
              Dia {i + 1}
            </label>
          );
        })}
      </div>
      <p className="mt-1 text-xs text-ink-soft">Até 7 dias por pedido.</p>
    </fieldset>
  );

  return (
    <form onSubmit={submit} className="space-y-5" aria-busy={busy}>
      <div role="tablist" aria-label="Tipo de pedido" className="grid grid-cols-3 gap-1 rounded-2xl bg-sand/60 p-1">
        {(Object.keys(kindLabels) as AiKind[]).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={kind === k}
            onClick={() => {
              setKind(k);
              setError(null);
              setFailed(null);
            }}
            className={cn(
              "min-h-10 rounded-xl px-2 py-2 text-sm font-semibold transition",
              kind === k ? "bg-white text-forest shadow-soft" : "text-ink-soft hover:text-ink",
            )}
          >
            {kindLabels[k].tab}
          </button>
        ))}
      </div>
      <UsageLine ai={ai} kind={kind} />

      {kind === "DAY_SUGGESTIONS" && (
        <label className="flex flex-col gap-1.5 text-sm font-semibold text-ink">
          Dia
          <select className={inputClasses} value={targetDay} onChange={(e) => setTargetDay(e.target.value)}>
            {trip.days.map((d, i) => (
              <option key={d.id} value={d.id}>
                Dia {i + 1} · {longDate(d.date)}
              </option>
            ))}
          </select>
        </label>
      )}
      {kind === "TRIP_SUGGESTIONS" && dayChecks(dayIds, setDayIds, "Dias")}
      {kind === "ADJUST_ITINERARY" && dayChecks(adjustDays, setAdjustDays, "Dias que podem mudar")}

      {kind !== "ADJUST_ITINERARY" ? (
        <>
          <fieldset>
            <legend className="text-sm font-semibold text-ink">
              Interesses <span className="font-normal text-ink-soft">(opcional)</span>
            </legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {interestOptions.map((opt) => {
                const checked = interests.includes(opt.label);
                return (
                  <label
                    key={opt.id}
                    className={cn(
                      "inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-forest",
                      checked ? "border-forest bg-forest text-cream" : "border-line bg-white text-ink hover:border-forest/40",
                    )}
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={checked}
                      onChange={() => setInterests((l) => (checked ? l.filter((i) => i !== opt.label) : [...l, opt.label]))}
                    />
                    {checked && <Check aria-hidden className="size-3.5" />}
                    {opt.label}
                  </label>
                );
              })}
            </div>
          </fieldset>
          <Segmented legend="Ritmo" name="ritmo" value={pace} onChange={setPace} options={(Object.keys(paceLabels) as Pace[]).map((p) => ({ value: p, label: paceLabels[p] }))} />
          <Segmented
            legend="Orçamento"
            name="orcamento"
            value={budget}
            onChange={setBudget}
            options={(Object.keys(budgetLabels) as Budget[]).map((b) => ({ value: b, label: budgetLabels[b] }))}
          />
          <TextArea
            id="pedido-livre"
            label="Pedido livre"
            optional
            value={prompt}
            onChange={setPrompt}
            placeholder="Ex.: queremos um dia sem pressa, com praia de manhã e um lugar bonito para o pôr do sol."
          />
        </>
      ) : (
        <TextArea
          id="instrucao-ajuste"
          label="O que você quer ajustar?"
          value={instruction}
          onChange={setInstruction}
          placeholder="Ex.: deixe a manhã do dia 2 mais tranquila e inclua um almoço perto da praia."
        />
      )}

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-2xl bg-[#fbe4df] px-3.5 py-3 text-sm text-[#7a2a1a]">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          <div className="flex-1">
            {error}
            {failed && (
              <Button size="sm" variant="secondary" className="mt-2" disabled={busy} onClick={() => void send(failed)}>
                <RotateCcw aria-hidden className="size-4" /> Tentar enviar de novo
              </Button>
            )}
          </div>
        </div>
      )}

      <Button type="submit" variant="coral" className="w-full" disabled={busy || remaining === 0 || text.length > PROMPT_MAX}>
        {busy ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : <Sparkles aria-hidden className="size-4" />}
        {busy ? "Enviando pedido…" : kind === "ADJUST_ITINERARY" ? "Propor ajustes" : "Gerar sugestões"}
      </Button>
      <p className="text-xs text-ink-soft">A IA pode errar. Nada entra no roteiro sem a sua revisão.</p>
    </form>
  );
}

function TextArea({
  id,
  label,
  optional,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  optional?: boolean;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  const over = value.length > PROMPT_MAX;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold text-ink">
        {label} {optional && <span className="font-normal text-ink-soft">(opcional)</span>}
      </label>
      <textarea
        id={id}
        rows={3}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={over || undefined}
        aria-describedby={`${id}-contador`}
        className={cn(inputClasses, "resize-none")}
        placeholder={placeholder}
      />
      <p id={`${id}-contador`} className={cn("text-right text-xs", over ? "font-semibold text-[#b3261e]" : "text-ink-soft")}>
        {value.length}/{PROMPT_MAX}
      </p>
    </div>
  );
}

function Segmented<T extends string>({
  legend,
  name,
  value,
  onChange,
  options,
}: {
  legend: string;
  name: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <fieldset>
      <legend className="text-sm font-semibold text-ink">{legend}</legend>
      <div className="mt-2 grid grid-cols-3 gap-1 rounded-2xl bg-sand/60 p-1">
        {options.map((o) => (
          <label
            key={o.value}
            className={cn(
              "cursor-pointer rounded-xl px-2 py-2 text-center text-sm font-semibold transition has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-forest",
              value === o.value ? "bg-white text-forest shadow-soft" : "text-ink-soft hover:text-ink",
            )}
          >
            <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} className="sr-only" />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/* ───────────────────────────── Acompanhamento ───────────────────────────── */

function JobTracker({
  trip,
  jobId,
  onBack,
  entitlements,
  ownerName,
}: {
  trip: Trip;
  jobId: string;
  onBack: () => void;
  entitlements: EntitlementsDto | undefined;
  ownerName?: string;
}) {
  const qc = useQueryClient();
  const refreshTrip = useRefreshTrip(trip.id);
  const [base, setBase] = useState(0);
  // O polling para sozinho ao concluir/falhar, ao fechar o painel (consulta desmontada) e no logout (cache limpo)
  const query = useQuery({
    queryKey: keys.aiJob(trip.id, jobId),
    queryFn: () => aiApi.job(trip.id, jobId),
    refetchInterval: (q) => {
      const job = q.state.data;
      if (q.state.error || (job && !isActiveJob(job))) return false;
      return q.state.dataUpdateCount - base >= MAX_POLLS ? false : POLL_MS;
    },
    refetchIntervalInBackground: false,
  });
  const job = query.data;
  const updates = qc.getQueryState(keys.aiJob(trip.id, jobId))?.dataUpdateCount ?? 0;
  const heading = useRef<HTMLHeadingElement>(null);
  const finished = job && !isActiveJob(job);

  useEffect(() => {
    if (!finished) return;
    void qc.invalidateQueries({ queryKey: keys.aiUsage(trip.id) });
    heading.current?.focus();
  }, [finished, qc, trip.id]);

  const back = (
    <button
      type="button"
      onClick={onBack}
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold text-forest hover:bg-forest/5"
    >
      <RotateCcw aria-hidden className="size-4" /> Novo pedido
    </button>
  );

  if (!job) {
    return query.isError ? (
      <Blocked title="Não foi possível acompanhar a geração">
        {errorMessage(query.error)}
        <div className="mt-3 flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => void query.refetch()}>
            Consultar de novo
          </Button>
          {back}
        </div>
      </Blocked>
    ) : (
      <p role="status" className="flex items-center gap-2 text-sm text-ink-soft">
        <LoaderCircle aria-hidden className="size-4 animate-spin text-forest" /> Carregando geração…
      </p>
    );
  }

  if (isActiveJob(job)) {
    const stopped = updates - base >= MAX_POLLS || !!query.error;
    return (
      <div role="status" aria-live="polite" className="space-y-3">
        <p className="flex items-center gap-2 font-semibold text-forest">
          <Sparkles aria-hidden className={cn("size-4 text-coral-700", !stopped && "animate-pulse")} />
          {job.status === "QUEUED" ? "Pedido na fila…" : "A IA está montando as sugestões…"}
        </p>
        <p className="text-sm text-ink-soft">
          {stopped
            ? "Está demorando mais que o normal. A geração continua no servidor; você pode consultar de novo ou fechar e voltar depois."
            : "Pode levar alguns segundos. Se fechar o painel, a geração continua e você a encontra aqui ao voltar."}
        </p>
        {stopped ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setBase(updates);
              void query.refetch();
            }}
          >
            <RefreshCw aria-hidden className="size-4" /> Consultar novamente
          </Button>
        ) : (
          [0, 1, 2].map((i) => (
            <div key={i} className="animate-pulse rounded-2xl border border-line bg-white p-4">
              <div className="h-3 w-12 rounded bg-sand" />
              <div className="mt-3 h-4 w-3/4 rounded bg-sand" />
              <div className="mt-2 h-3 w-1/2 rounded bg-sand/70" />
            </div>
          ))
        )}
      </div>
    );
  }

  if (job.status === "FAILED") {
    const copy = jobFailureCopy(job.error?.code ?? "");
    return (
      <div role="alert" className="space-y-3 rounded-2xl border border-[#e8c98a] bg-[#fbf2df] p-5">
        <h3 ref={heading} tabIndex={-1} className="flex items-center gap-2 font-display text-lg font-bold text-forest outline-none">
          <TriangleAlert aria-hidden className="size-5 text-[#7a5200]" /> {copy.title}
        </h3>
        {job.error?.message && <p className="text-sm text-ink">{job.error.message}</p>}
        <p className="text-sm text-ink-soft">{copy.hint} Suas atividades não foram alteradas.</p>
        {back}
      </div>
    );
  }

  const count = job.result?.type === "adjustment" ? (job.result.changes?.length ?? 0) : (job.result?.suggestions?.length ?? 0);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 ref={heading} tabIndex={-1} className="font-display text-lg font-bold text-forest outline-none">
          {job.result?.type === "adjustment"
            ? plural(count, "ajuste para revisar", "ajustes para revisar")
            : plural(count, "sugestão para revisar", "sugestões para revisar")}
        </h3>
        {back}
      </div>
      {job.result?.type === "adjustment" ? (
        <AdjustmentsReview job={job} trip={trip} onApplied={refreshTrip} />
      ) : (
        <SuggestionsReview
          job={job}
          trip={trip}
          onApplied={refreshTrip}
          renderLimit={() =>
            entitlements ? (
              <UpgradePanel
                tripId={trip.id}
                entitlements={entitlements}
                ownerName={ownerName}
                reason="Um dos dias atingiu o limite de atividades do plano. Nenhuma sugestão foi adicionada."
              />
            ) : null
          }
        />
      )}
    </div>
  );
}
