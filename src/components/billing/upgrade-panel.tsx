"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Check, Crown, ExternalLink, LoaderCircle, Lock, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { errorMessage, isApiError } from "@/api/client";
import type { EntitlementsDto, Plan } from "@/api/contracts";
import { billingApi } from "@/api/endpoints";
import { Button, buttonClasses } from "@/components/ui/button";
import { ACTIVE_ORDER, formatMoney, ONE_TIME_NOTE, planLabels, productCopy } from "@/lib/plans";
import { cn } from "@/lib/utils";
import { invalidatePlan, useTripOrders } from "@/state/queries";

interface UpgradePanelProps {
  tripId: string;
  entitlements: EntitlementsDto;
  /** Por que o upgrade apareceu (ex.: limite de atividades) */
  reason?: React.ReactNode;
  /** Nome de quem pode comprar, para orientar convidados */
  ownerName?: string;
  /** Restringe as opções (ex.: só planos com IA) */
  only?: Plan[];
  className?: string;
}

/**
 * Opções de upgrade decididas pelo backend. Quem não é proprietário não compra:
 * recebe orientação para falar com o proprietário.
 */
export function UpgradePanel({ tripId, entitlements, reason, ownerName, only, className }: UpgradePanelProps) {
  const options = entitlements.availableUpgrades.filter((o) => !only || only.includes(o.plan));

  return (
    <section
      aria-label="Planos para esta viagem"
      className={cn("rounded-2xl border border-coral/40 bg-coral-100/50 p-4", className)}
    >
      <p className="flex items-center gap-2 font-display text-lg font-bold text-forest">
        <Crown aria-hidden className="size-5 text-coral-700" /> Mais recursos para esta viagem
      </p>
      {reason && <p className="mt-1 text-sm text-ink">{reason}</p>}
      <p className="mt-1 text-xs text-ink-soft">
        Plano atual: <strong className="font-semibold text-ink">{planLabels[entitlements.plan]}</strong>
      </p>

      {!entitlements.canPurchase ? (
        <p className="mt-3 flex items-start gap-2 rounded-xl bg-white/80 px-3 py-2.5 text-sm text-ink">
          <Lock aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-soft" />
          <span>
            Só quem criou a viagem pode contratar um plano. Fale com {ownerName ?? "o proprietário"} para liberar mais
            recursos.
          </span>
        </p>
      ) : entitlements.hasPendingOrder ? (
        <PendingOrder tripId={tripId} />
      ) : options.length === 0 ? (
        <p className="mt-3 text-sm text-ink-soft">Não há upgrades disponíveis para o plano atual.</p>
      ) : (
        <PurchaseOptions tripId={tripId} options={options} />
      )}
    </section>
  );
}

function PurchaseOptions({ tripId, options }: { tripId: string; options: EntitlementsDto["availableUpgrades"] }) {
  const qc = useQueryClient();
  const router = useRouter();
  const [busy, setBusy] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);

  async function buy(plan: "PRO" | "PRO_AI") {
    // Bloqueia cliques repetidos antes mesmo do re-render
    if (lock.current) return;
    lock.current = true;
    setBusy(plan);
    setError(null);
    try {
      const { checkoutUrl } = await billingApi.checkout(tripId, plan);
      window.location.assign(checkoutUrl);
      return; // mantém o bloqueio enquanto o navegador sai da página
    } catch (e) {
      if (isApiError(e, "PAYMENT_PENDING")) {
        const orderId = typeof e.details.orderId === "string" ? e.details.orderId : null;
        if (orderId) {
          router.push(`/app/viagens/${tripId}/pagamento?pedido=${orderId}`);
          return;
        }
        setError(e.message);
      } else if (isApiError(e, "PLAN_ALREADY_ACTIVE") || isApiError(e, "PLAN_NOT_ELIGIBLE")) {
        setError("O plano desta viagem mudou. Atualizamos as opções disponíveis.");
      } else if (isApiError(e, "BILLING_UNAVAILABLE") || isApiError(e, "BILLING_MISCONFIGURED")) {
        setError("Os pagamentos não estão disponíveis no momento. Nada foi cobrado. Tente mais tarde.");
      } else {
        setError(errorMessage(e, "Não foi possível iniciar o pagamento. Nada foi cobrado."));
      }
      void invalidatePlan(qc, tripId);
    }
    lock.current = false;
    setBusy(null);
  }

  return (
    <div className="mt-3 space-y-2">
      {error && (
        <p role="alert" className="flex items-start gap-2 rounded-xl bg-[#fbe4df] px-3 py-2 text-sm text-[#7a2a1a]">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}
      {options.map((o) => {
        const copy = productCopy[o.product];
        const plan = o.plan as "PRO" | "PRO_AI";
        return (
          <div key={o.product} className="rounded-xl border border-line bg-white p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-semibold text-forest">{copy.title}</p>
              <p className="font-display text-lg font-bold text-ink">{formatMoney(o.amount, o.currency)}</p>
            </div>
            <ul className="mt-1.5 space-y-1 text-sm text-ink-soft">
              {copy.benefits.map((b) => (
                <li key={b} className="flex items-start gap-1.5">
                  <Check aria-hidden className="mt-0.5 size-3.5 shrink-0 text-forest" /> {b}
                </li>
              ))}
            </ul>
            <Button
              className="mt-3 w-full"
              variant={plan === "PRO_AI" ? "coral" : "primary"}
              disabled={busy !== null}
              aria-busy={busy === plan}
              onClick={() => void buy(plan)}
            >
              {busy === plan && <LoaderCircle aria-hidden className="size-4 animate-spin" />}
              {busy === plan ? "Abrindo pagamento…" : `Contratar ${copy.title} · ${formatMoney(o.amount, o.currency)}`}
            </Button>
          </div>
        );
      })}
      <p className="text-xs text-ink-soft">
        {ONE_TIME_NOTE}, sem assinatura nem mensalidade. O pagamento é feito no Stripe e o plano só é liberado depois da
        confirmação.
      </p>
    </div>
  );
}

function PendingOrder({ tripId }: { tripId: string }) {
  const orders = useTripOrders(tripId, true);
  const active = orders.data?.find((o) => ACTIVE_ORDER.includes(o.status));
  return (
    <div className="mt-3 space-y-2 rounded-xl bg-white/80 px-3 py-3 text-sm text-ink">
      <p>Já existe um pagamento em andamento para esta viagem. Aguarde a confirmação antes de iniciar outro.</p>
      {orders.isLoading && <LoaderCircle aria-label="Carregando pedido" className="size-4 animate-spin text-forest" />}
      {active && (
        <div className="flex flex-wrap gap-2">
          {active.status === "OPEN" && active.checkoutUrl && (
            <a href={active.checkoutUrl} className={buttonClasses("primary", "sm")}>
              Continuar pagamento <ExternalLink aria-hidden className="size-3.5" />
            </a>
          )}
          <Link href={`/app/viagens/${tripId}/pagamento?pedido=${active.id}`} className={buttonClasses("secondary", "sm")}>
            Acompanhar pagamento
          </Link>
        </div>
      )}
    </div>
  );
}
