import { Injectable } from '@nestjs/common';
import { ActivityCategory } from '@prisma/client';
import { AiProvider, AiTask, AiTaskOutput, AttemptOptions, AttemptResult } from './ai-provider';
import type { ModelAdjustOutput, ModelSuggestionsOutput } from './ai.schemas';

const TEMPLATES: { time: string; title: string; category: ActivityCategory; duration: number }[] = [
  { time: '09:00', title: 'Café da manhã em padaria local', category: 'alimentacao', duration: 45 },
  { time: '10:00', title: 'Caminhada pelo centro histórico', category: 'passeio', duration: 120 },
  { time: '12:30', title: 'Almoço com prato típico', category: 'alimentacao', duration: 75 },
  { time: '14:30', title: 'Museu ou galeria da região', category: 'passeio', duration: 90 },
  { time: '16:30', title: 'Pausa para descanso', category: 'descanso', duration: 60 },
  { time: '18:00', title: 'Mirante para o pôr do sol', category: 'passeio', duration: 60 },
  { time: '20:00', title: 'Jantar em restaurante bem avaliado', category: 'alimentacao', duration: 90 },
];

const PER_DAY = { tranquilo: 2, equilibrado: 3, intenso: 5 } as const;

/**
 * Provedor simulado e determinístico. Só é instanciado em development/test
 * (env.ts recusa AI_PROVIDER=mock em produção). Não chama nenhum serviço.
 */
@Injectable()
export class MockAiProvider extends AiProvider {
  readonly name: string = 'mock';

  async attempt<T extends AiTask>(task: T, _options: AttemptOptions): Promise<AttemptResult<AiTaskOutput<T>>> {
    await new Promise((r) => setTimeout(r, 50));
    const data = task.type === 'suggest' ? this.suggest(task) : this.adjust(task);
    return {
      status: 'success',
      data: data as AiTaskOutput<T>,
      model: 'mock-planner',
      requestId: null,
      usage: { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: null, cacheReadInputTokens: null },
    };
  }

  private suggest(task: Extract<AiTask, { type: 'suggest' }>): ModelSuggestionsOutput {
    const perDay = Math.min(PER_DAY[task.preferences.pace], task.limits.maxSuggestionsPerDay);
    const suggestions = task.days.flatMap((day) => {
      const taken = new Set(day.activities.map((a) => a.time));
      return TEMPLATES.filter((t) => !taken.has(t.time))
        .slice(0, perDay)
        .map((t) => ({
          date: day.date,
          time: t.time,
          title: `${t.title} — ${task.trip.destination}`,
          durationMinutes: t.duration,
          category: t.category,
          location: null,
          notes: 'Sugestão de demonstração (IA simulada).',
          reason: 'Combina com o ritmo escolhido e preenche um horário livre.',
          estimatedCost: { amount: null, currency: null, note: 'Sem estimativa na simulação.' },
        }));
    });
    return { suggestions, notes: ['Sugestões geradas pelo provedor simulado de desenvolvimento.'] };
  }

  private adjust(task: Extract<AiTask, { type: 'adjust' }>): ModelAdjustOutput {
    const day = task.days.find((d) => d.activities.length > 0) ?? task.days[0];
    const first = day?.activities[0];
    const changes: ModelAdjustOutput['changes'] = [];
    if (first) {
      changes.push({
        type: 'update',
        date: day.date,
        activityId: first.id,
        activity: {
          title: first.title,
          time: first.time === '23:00' ? first.time : addHour(first.time),
          durationMinutes: first.durationMinutes,
          category: first.category as ActivityCategory,
          location: first.location,
          notes: null,
        },
        reason: 'Começar uma hora mais tarde deixa a manhã mais tranquila.',
      });
    }
    if (day) {
      changes.push({
        type: 'add',
        date: day.date,
        activityId: null,
        activity: { title: 'Pausa para descanso', time: '15:00', durationMinutes: 60, category: 'descanso', location: null, notes: null },
        reason: 'Inclui um intervalo no meio da tarde.',
      });
    }
    return { summary: `Ajustes simulados para: ${task.instruction.slice(0, 80)}`, changes, notes: [] };
  }
}

function addHour(time: string): string {
  const [h, m] = time.split(':').map(Number);
  return `${String(Math.min(h + 1, 23)).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
