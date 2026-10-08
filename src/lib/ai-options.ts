import type { AiJobDto, AiKind, Budget, Pace } from "@/api/contracts";

export const interestOptions = [
  { id: "praia", label: "Praia" },
  { id: "gastronomia", label: "Gastronomia" },
  { id: "cultura", label: "Cultura e história" },
  { id: "natureza", label: "Natureza e trilhas" },
  { id: "vista", label: "Mirantes e pôr do sol" },
  { id: "noite", label: "Vida noturna" },
] as const;

export const paceLabels: Record<Pace, string> = {
  tranquilo: "Tranquilo",
  equilibrado: "Equilibrado",
  intenso: "Intenso",
};

export const budgetLabels: Record<Budget, string> = {
  economico: "Econômico",
  moderado: "Moderado",
  confortavel: "Confortável",
};

export const kindLabels: Record<AiKind, { tab: string; usage: string }> = {
  DAY_SUGGESTIONS: { tab: "Este dia", usage: "Sugestões para um dia" },
  TRIP_SUGGESTIONS: { tab: "Viagem toda", usage: "Sugestões para a viagem toda" },
  ADJUST_ITINERARY: { tab: "Ajustar", usage: "Ajustes no roteiro" },
};

export const isActiveJob = (job: Pick<AiJobDto, "status">) => job.status === "QUEUED" || job.status === "RUNNING";

/** Título e orientação para cada motivo de falha do trabalho de IA. */
export function jobFailureCopy(code: string): { title: string; hint: string } {
  switch (code) {
    case "AI_REQUEST_REFUSED":
      return { title: "A IA não atendeu a este pedido", hint: "Reformule o pedido e tente de novo. Este uso não foi descontado." };
    case "AI_BUDGET_EXHAUSTED":
      return { title: "O uso de IA desta viagem chegou ao limite", hint: "Não é possível fazer novas gerações nesta viagem." };
    case "AI_UNAVAILABLE":
      return { title: "IA indisponível no momento", hint: "Tente mais tarde. Este uso não foi descontado." };
    case "AI_TIMEOUT":
    case "AI_WORKER_TIMEOUT":
      return { title: "A geração demorou demais", hint: "Tente de novo em instantes. Este uso não foi descontado." };
    case "AI_RATE_LIMITED":
      return { title: "Muitos pedidos à IA agora", hint: "Aguarde alguns minutos e tente de novo. Este uso não foi descontado." };
    default:
      return { title: "Não foi possível gerar", hint: "Tente de novo mais tarde. Este uso não foi descontado." };
  }
}
