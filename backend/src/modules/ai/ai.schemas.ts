import { ActivityCategory } from '@prisma/client';
import { z } from 'zod';

/**
 * Schemas enviados ao modelo (structured outputs). Ficam propositalmente sem
 * restrições de formato (regex, min/max), que nem todo recurso de saída
 * estruturada suporta; a validação estrita acontece depois, em `ai-result.ts`.
 */

const category = z.enum(Object.values(ActivityCategory) as [ActivityCategory, ...ActivityCategory[]]);

const activityFields = {
  title: z.string().describe('Nome curto da atividade'),
  time: z.string().describe('Horário local HH:MM (24h) no fuso do destino'),
  durationMinutes: z.number().int().nullable().describe('Duração estimada em minutos, ou null'),
  category,
  location: z.string().nullable().describe('Nome do lugar e bairro/endereço aproximado, ou null'),
  notes: z.string().nullable().describe('Dicas práticas curtas, ou null'),
};

const estimatedCost = z
  .object({
    amount: z.number().nullable().describe('Valor aproximado por pessoa, ou null se desconhecido'),
    currency: z.string().nullable().describe('Código ISO 4217 da moeda, ou null'),
    note: z.string().nullable().describe('Contexto da estimativa (ex.: "faixa típica, não verificada")'),
  })
  .nullable();

export const modelSuggestionSchema = z.object({
  date: z.string().describe('Data local YYYY-MM-DD de um dos dias solicitados'),
  ...activityFields,
  reason: z.string().describe('Por que esta sugestão combina com o pedido'),
  estimatedCost,
});

export const modelSuggestionsOutputSchema = z.object({
  suggestions: z.array(modelSuggestionSchema),
  notes: z.array(z.string()).describe('Observações gerais e ressalvas'),
});

export const modelAdjustOutputSchema = z.object({
  summary: z.string().describe('Resumo das mudanças propostas'),
  changes: z.array(
    z.object({
      type: z.enum(['add', 'update', 'remove']),
      date: z.string().describe('Data local YYYY-MM-DD do dia afetado (para update: o dia de destino)'),
      activityId: z.string().nullable().describe('ID da atividade existente (update/remove); null para add'),
      activity: z.object(activityFields).nullable().describe('Dados completos da atividade (add/update); null para remove'),
      reason: z.string(),
    }),
  ),
  notes: z.array(z.string()),
});

export type ModelSuggestionsOutput = z.infer<typeof modelSuggestionsOutputSchema>;
export type ModelAdjustOutput = z.infer<typeof modelAdjustOutputSchema>;

// ───────── Entradas dos trabalhos (persistidas em AiJob.input) ─────────

export const preferencesSchema = z.object({
  interests: z.array(z.string().max(60)).max(10).default([]),
  pace: z.enum(['tranquilo', 'equilibrado', 'intenso']).default('equilibrado'),
  budget: z.enum(['economico', 'moderado', 'confortavel']).default('moderado'),
  prompt: z.string().max(2000).optional(),
});
export type Preferences = z.infer<typeof preferencesSchema>;

export const jobInputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('DAY_SUGGESTIONS'), dayId: z.uuid(), preferences: preferencesSchema }),
  z.object({
    kind: z.literal('TRIP_SUGGESTIONS'),
    preferences: preferencesSchema,
    dayIds: z.array(z.uuid()).max(60).optional(),
  }),
  z.object({
    kind: z.literal('ADJUST_ITINERARY'),
    instruction: z.string().min(1).max(2000),
    dayIds: z.array(z.uuid()).max(60).optional(),
  }),
]);
export type JobInput = z.infer<typeof jobInputSchema>;
