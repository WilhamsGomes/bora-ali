import { BillingProduct, TripPlan } from '@prisma/client';

/** Regras comerciais por plano. Fonte única de verdade — nenhum limite vive só no frontend. */
export interface PlanFeatures {
  /** null = ilimitado */
  maxActivitiesPerDay: number | null;
  collaboration: boolean;
  publicSharing: boolean;
  ai: boolean;
}

export const PLAN_FEATURES: Record<TripPlan, PlanFeatures> = {
  FREE: { maxActivitiesPerDay: 5, collaboration: false, publicSharing: false, ai: false },
  PRO: { maxActivitiesPerDay: null, collaboration: true, publicSharing: true, ai: false },
  PRO_AI: { maxActivitiesPerDay: null, collaboration: true, publicSharing: true, ai: true },
};

export type Feature = Exclude<keyof PlanFeatures, 'maxActivitiesPerDay'>;

export const PLAN_RANK: Record<TripPlan, number> = { FREE: 0, PRO: 1, PRO_AI: 2 };

export const CURRENCY = 'brl';

/** Preços internos em centavos. O Stripe precisa ter preços com exatamente estes valores. */
export const PRODUCT_CATALOG: Record<BillingProduct, { amount: number; targetPlan: TripPlan; label: string }> = {
  PRO: { amount: 990, targetPlan: TripPlan.PRO, label: 'BoraAli PRO (por viagem)' },
  PRO_AI: { amount: 1990, targetPlan: TripPlan.PRO_AI, label: 'BoraAli PRO + IA (por viagem)' },
  UPGRADE_PRO_AI: { amount: 1000, targetPlan: TripPlan.PRO_AI, label: 'Upgrade PRO → PRO + IA' },
};

export type PurchaseDecision =
  | { ok: true; product: BillingProduct; amount: number; targetPlan: TripPlan }
  | { ok: false; reason: 'PLAN_ALREADY_ACTIVE' | 'PLAN_NOT_ELIGIBLE' };

/**
 * Decide o produto e o preço a partir do plano atual e do plano desejado.
 * - FREE → PRO ou PRO_AI: compra direta.
 * - PRO → PRO_AI: somente via upgrade (R$10,00).
 * - PRO → PRO, PRO_AI → qualquer: não elegível.
 */
export function decidePurchase(current: TripPlan, desired: TripPlan): PurchaseDecision {
  if (desired === TripPlan.FREE) return { ok: false, reason: 'PLAN_NOT_ELIGIBLE' };
  if (current === desired) return { ok: false, reason: 'PLAN_ALREADY_ACTIVE' };
  if (PLAN_RANK[current] > PLAN_RANK[desired]) return { ok: false, reason: 'PLAN_NOT_ELIGIBLE' };

  const product: BillingProduct =
    current === TripPlan.FREE ? (desired === TripPlan.PRO ? BillingProduct.PRO : BillingProduct.PRO_AI) : BillingProduct.UPGRADE_PRO_AI;
  const { amount, targetPlan } = PRODUCT_CATALOG[product];
  return { ok: true, product, amount, targetPlan };
}

export interface UpgradeOption {
  plan: TripPlan;
  product: BillingProduct;
  amount: number;
  currency: string;
}

export function availableUpgrades(current: TripPlan): UpgradeOption[] {
  return ([TripPlan.PRO, TripPlan.PRO_AI] as TripPlan[]).flatMap((plan) => {
    const d = decidePurchase(current, plan);
    return d.ok ? [{ plan, product: d.product, amount: d.amount, currency: CURRENCY.toUpperCase() }] : [];
  });
}

/** Planos que liberam um recurso (para mensagens de upgrade). */
export function plansWith(feature: Feature): TripPlan[] {
  return (Object.keys(PLAN_FEATURES) as TripPlan[]).filter((p) => PLAN_FEATURES[p][feature]);
}

/**
 * Plano efetivo a partir dos pedidos pagos (ainda válidos) da viagem. É determinístico
 * e independe da ordem dos eventos — por isso é usado tanto para liberar quanto para
 * reverter benefícios. O upgrade só vale se houver um PRO pago vigente.
 */
export function planFromPaidProducts(products: BillingProduct[]): TripPlan {
  const set = new Set(products);
  if (set.has(BillingProduct.PRO_AI)) return TripPlan.PRO_AI;
  if (set.has(BillingProduct.PRO) && set.has(BillingProduct.UPGRADE_PRO_AI)) return TripPlan.PRO_AI;
  if (set.has(BillingProduct.PRO)) return TripPlan.PRO;
  return TripPlan.FREE;
}
