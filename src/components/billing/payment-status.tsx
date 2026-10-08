"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, CircleX, Clock, ExternalLink, Hourglass, LoaderCircle, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { errorMessage, isApiError } from "@/api/client";
import type { OrderDto } from "@/api/contracts";
import { billingApi } from "@/api/endpoints";
import { Button, buttonClasses } from "@/components/ui/button";
import { ACTIVE_ORDER, formatMoney, ONE_TIME_NOTE, planLabels, productCopy } from "@/lib/plans";
import { invalidatePlan, keys } from "@/state/queries";

/** Consultas automáticas (a cada 2 s) antes de pedir ao usuário que consulte de novo. */
const POLL_MS = 2000;
const MAX_POLLS = 30;

const REVIEW_REASONS = ["paid_without_effect", "duplicate_payment"];

/**
 * Retorno do Stripe. O redirect não libera nada: o estado vem sempre de
 * GET /billing/orders/:id, que o servidor confirma junto ao Stripe.
 */
export function PaymentStatus({ tripId }: { tripId: string }) {
  const params = useSearchParams();
  const orderId = params.get("pedido");
  if (!orderId) {
    return (
      <Shell tripId={tripId} tone="warn" icon={TriangleAlert} title="Pedido não informado">
        Não encontramos o número do pedido neste endereço. Volte para a viagem para ver o plano atual.
      </Shell>
    );
  }
  return <OrderTracker tripId={tripId} orderId={orderId} />;
}

function OrderTracker({ tripId, orderId }: { tripId: string; orderId: string }) {
  const qc = useQueryClient();
  // Base para contar as consultas desta rodada (reiniciada por "Consultar novamente")
  const [base, setBase] = useState(0);
  const query = useQuery({
    queryKey: keys.order(orderId),
    queryFn: () => billingApi.order(orderId),
    retry: (count, e) => !isApiError(e) && count < 2,
    refetchInterval: (q) => {
      const order = q.state.data;
      if (order && !ACTIVE_ORDER.includes(order.status)) return false;
      if (q.state.error) return false;
      return q.state.dataUpdateCount - base >= MAX_POLLS ? false : POLL_MS;
    },
    refetchIntervalInBackground: false,
  });
  const order = query.data;
  const updates = qc.getQueryState(keys.order(orderId))?.dataUpdateCount ?? 0;
  const pollingDone = updates - base >= MAX_POLLS || !!query.error;

  // Pagamento confirmado: atualiza viagem, benefícios e pedidos (uma vez)
  const invalidated = useRef(false);
  useEffect(() => {
    if (order?.status === "PAID" && !invalidated.current) {
      invalidated.current = true;
      void invalidatePlan(qc, tripId);
    }
  }, [order?.status, qc, tripId]);

  if (query.isPending) {
    return (
      <Shell tripId={tripId} tone="wait" icon={LoaderCircle} spin title="Consultando o pagamento…">
        Estamos conferindo o pedido com o servidor.
      </Shell>
    );
  }

  if (query.error && !order) {
    const notFound = isApiError(query.error, "ORDER_NOT_FOUND");
    return (
      <Shell tripId={tripId} tone="warn" icon={TriangleAlert} title={notFound ? "Pedido não encontrado" : "Não foi possível consultar o pagamento"}>
        {notFound
          ? "Este pedido não existe ou pertence a outra conta."
          : `${errorMessage(query.error)} Nenhum benefício é liberado sem a confirmação do servidor.`}
        {!notFound && (
          <Button variant="secondary" className="mt-4" onClick={() => void query.refetch()}>
            <RefreshCw aria-hidden className="size-4" /> Consultar novamente
          </Button>
        )}
      </Shell>
    );
  }

  if (!order) return null;
  const again = (
    <Button
      variant="secondary"
      className="mt-4"
      disabled={query.isFetching}
      onClick={() => {
        setBase(updates);
        void query.refetch();
      }}
    >
      <RefreshCw aria-hidden className={query.isFetching ? "size-4 animate-spin" : "size-4"} /> Consultar novamente
    </Button>
  );

  return <OrderView tripId={tripId} order={order} pollingDone={pollingDone} again={again} />;
}

function OrderView({
  tripId,
  order,
  pollingDone,
  again,
}: {
  tripId: string;
  order: OrderDto;
  pollingDone: boolean;
  again: React.ReactNode;
}) {
  const product = productCopy[order.product].title;
  const summary = (
    <p className="mt-3 text-sm text-ink-soft">
      {product} · {formatMoney(order.amount, order.currency)} · {ONE_TIME_NOTE.toLowerCase()}
    </p>
  );
  const review = order.failureReason && (REVIEW_REASONS.includes(order.failureReason) || order.failureReason.startsWith("validation_mismatch"));

  switch (order.status) {
    case "PAID":
      if (review) {
        return (
          <Shell tripId={tripId} tone="warn" icon={ShieldCheck} title="Pagamento recebido, em revisão manual">
            Recebemos o pagamento, mas ele não mudou o plano desta viagem (por exemplo, por ser repetido). Ele ficou para
            revisão manual e deve ser reembolsado. O plano atual é {planLabels[order.tripPlan]}.
            {summary}
          </Shell>
        );
      }
      return (
        <Shell tripId={tripId} tone="ok" icon={CircleCheck} title={`Plano ${planLabels[order.tripPlan]} liberado`}>
          Pagamento confirmado. Os novos recursos já estão disponíveis nesta viagem.
          {summary}
        </Shell>
      );
    case "CREATED":
    case "OPEN":
      if (review) {
        return (
          <Shell tripId={tripId} tone="warn" icon={ShieldCheck} title="Pagamento em revisão manual">
            Encontramos uma divergência ao conferir este pagamento. Nenhum benefício foi liberado e o pedido será revisado.
            {summary}
          </Shell>
        );
      }
      return (
        <Shell
          tripId={tripId}
          tone="wait"
          icon={pollingDone ? Clock : LoaderCircle}
          spin={!pollingDone}
          title={pollingDone ? "Ainda sem confirmação" : "Aguardando a confirmação do pagamento…"}
        >
          {pollingDone
            ? "A confirmação está demorando mais que o normal. Se você concluiu o pagamento, consulte de novo em instantes. O plano só muda depois da confirmação."
            : "Isso costuma levar alguns segundos. Você pode continuar nesta página."}
          {summary}
          {pollingDone && (
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {again}
              {order.status === "OPEN" && order.checkoutUrl && (
                <a href={order.checkoutUrl} className={buttonClasses("secondary", "md", "mt-4")}>
                  Continuar pagamento <ExternalLink aria-hidden className="size-4" />
                </a>
              )}
            </div>
          )}
        </Shell>
      );
    case "PROCESSING":
      return (
        <Shell tripId={tripId} tone="wait" icon={Hourglass} title="Pagamento em análise">
          O pagamento foi enviado e aguarda a confirmação da instituição (ex.: Pix ou boleto). Isso pode levar de minutos a
          alguns dias úteis. O plano é liberado assim que a confirmação chegar.
          {summary}
          {pollingDone && <div className="flex justify-center">{again}</div>}
        </Shell>
      );
    case "FAILED":
      return (
        <Shell tripId={tripId} tone="error" icon={CircleX} title="Pagamento não aprovado">
          Nada foi liberado e, se houve cobrança pendente, ela não foi concluída. Você pode tentar novamente pela viagem.
          {summary}
        </Shell>
      );
    case "EXPIRED":
      return (
        <Shell tripId={tripId} tone="error" icon={Clock} title="O checkout expirou">
          O tempo para concluir o pagamento acabou e nada foi cobrado. Para contratar, inicie um novo pagamento pela viagem.
          {summary}
        </Shell>
      );
    case "CANCELED":
      return (
        <Shell tripId={tripId} tone="error" icon={CircleX} title="Pedido cancelado">
          Este pedido foi cancelado sem cobrança (por exemplo, porque um novo pagamento foi iniciado).
          {summary}
        </Shell>
      );
    case "REFUNDED":
      return (
        <Shell tripId={tripId} tone="warn" icon={CircleX} title="Pagamento reembolsado">
          Este pagamento foi reembolsado e os recursos dele não estão mais ativos. O plano atual é {planLabels[order.tripPlan]}.
          {summary}
        </Shell>
      );
    case "DISPUTED":
      return (
        <Shell tripId={tripId} tone="warn" icon={ShieldCheck} title="Pagamento em contestação">
          Há uma contestação aberta para este pagamento e os recursos dele estão suspensos até a conclusão. O roteiro não é
          apagado.
          {summary}
        </Shell>
      );
  }
}

const tones = {
  ok: "bg-forest-100 text-forest",
  wait: "bg-cream-200 text-forest",
  warn: "bg-[#fbf2df] text-[#7a5200]",
  error: "bg-[#fbe4df] text-[#9b2c1a]",
};

function Shell({
  tripId,
  tone,
  icon: Icon,
  spin,
  title,
  children,
}: {
  tripId: string;
  tone: keyof typeof tones;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  spin?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center px-6 py-20 text-center">
      <span className={`flex size-14 items-center justify-center rounded-2xl ${tones[tone]}`}>
        <Icon aria-hidden className={spin ? "size-7 animate-spin" : "size-7"} />
      </span>
      <div role="status" aria-live="polite">
        <h1 className="mt-4 font-display text-3xl font-bold text-forest">{title}</h1>
        <div className="mt-2 text-ink-soft">{children}</div>
      </div>
      <Link href={`/app/viagens/${tripId}`} className={buttonClasses("primary", "md", "mt-8")}>
        Voltar para a viagem
      </Link>
    </main>
  );
}
