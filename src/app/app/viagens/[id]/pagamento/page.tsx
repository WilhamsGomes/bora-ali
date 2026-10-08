import type { Metadata } from "next";
import { Suspense } from "react";
import { AppNav } from "@/components/app/app-nav";
import { PaymentStatus } from "@/components/billing/payment-status";

export const metadata: Metadata = { title: "Pagamento · BoraAli" };

/** Renderizada só depois de restaurar a sessão no cliente (ver app/app/layout.tsx). */
export const instant = false;

/** Retorno de sucesso do Stripe: /app/viagens/:id/pagamento?pedido=<orderId> */
export default function PagamentoPage({ params }: PageProps<"/app/viagens/[id]/pagamento">) {
  return (
    <>
      <AppNav />
      <Suspense>
        {params.then(({ id }) => (
          <PaymentStatus tripId={decodeURIComponent(id)} />
        ))}
      </Suspense>
    </>
  );
}
