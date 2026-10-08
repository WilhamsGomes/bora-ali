import type { OrderStatus, Plan, Product } from "@/api/contracts";

/** Textos de planos. Preços, limites e elegibilidade sempre vêm da API (entitlements). */

export const planLabels: Record<Plan, string> = {
  FREE: "Gratuito",
  PRO: "PRO",
  PRO_AI: "PRO + IA",
};

/**
 * Limite diário do plano gratuito, só como reserva enquanto a API não respondeu.
 * O valor que vale é o de `entitlements.maxActivitiesPerDay` (backend: plan-policy.ts).
 */
export const FREE_ACTIVITIES_PER_DAY = 5;

export const ONE_TIME_NOTE = "Pagamento único por viagem";

export const productCopy: Record<Product, { title: string; benefits: string[] }> = {
  PRO: {
    title: "PRO",
    benefits: ["Atividades ilimitadas por dia", "Convidar pessoas para editar ou ver", "Link público somente leitura"],
  },
  PRO_AI: {
    title: "PRO + IA",
    benefits: ["Tudo do PRO", "Sugestões e ajustes com IA, com uso limitado por viagem"],
  },
  UPGRADE_PRO_AI: {
    title: "Upgrade para PRO + IA",
    benefits: ["Mantém tudo do PRO", "Adiciona sugestões e ajustes com IA, com uso limitado por viagem"],
  },
};

export function formatMoney(cents: number, currency = "BRL") {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
}

export const ACTIVE_ORDER: OrderStatus[] = ["CREATED", "OPEN", "PROCESSING"];

export const roleLabels = {
  OWNER: "Proprietário",
  EDITOR: "Pode editar",
  VIEWER: "Pode ver",
} as const;
