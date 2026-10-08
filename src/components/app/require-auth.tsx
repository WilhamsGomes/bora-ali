"use client";

import { LoaderCircle, RefreshCw, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useSession } from "@/state/providers";

/** Caminho atual para voltar depois do login (inclui a query, ex.: ?pedido=...). */
export function currentPath() {
  return `${window.location.pathname}${window.location.search}`;
}

export function loginHref(next: string, expired = false) {
  const params = new URLSearchParams({ next });
  if (expired) params.set("motivo", "sessao");
  return `/entrar?${params.toString()}`;
}

/** Protege as rotas privadas: sem sessão, leva ao login guardando o destino. */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { state, retry } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (state.status === "anonymous") router.replace(loginHref(currentPath(), state.expired));
  }, [state, router]);

  if (state.status === "unavailable") {
    return (
      <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-32 text-center">
        <TriangleAlert aria-hidden className="size-7 text-[#7a5200]" />
        <p className="max-w-sm text-ink-soft">{state.message}</p>
        <Button variant="secondary" onClick={retry}>
          <RefreshCw aria-hidden className="size-4" /> Tentar novamente
        </Button>
      </div>
    );
  }
  if (state.status !== "authenticated") {
    return (
      <div role="status" className="flex flex-1 flex-col items-center justify-center gap-3 py-32 text-ink-soft">
        <LoaderCircle aria-hidden className="size-6 animate-spin text-forest" />
        <span className="text-sm">{state.status === "loading" ? "Abrindo sua conta…" : "Redirecionando para o login…"}</span>
      </div>
    );
  }
  return <>{children}</>;
}
