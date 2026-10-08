import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ActivityCategory, AiJobKind, AiJobStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { trim } from '../../../common/validators';

/** Teto absoluto de validação; o limite efetivo é AI_MAX_PROMPT_CHARS (erro AI_REQUEST_TOO_LARGE). */
const TEXT_HARD_CAP = 2000;

export class PreferencesDto {
  @ApiPropertyOptional({ type: [String], example: ['gastronomia', 'museus'], maxItems: 10 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  interests?: string[];

  @ApiPropertyOptional({ enum: ['tranquilo', 'equilibrado', 'intenso'], default: 'equilibrado' })
  @IsOptional()
  @IsIn(['tranquilo', 'equilibrado', 'intenso'])
  pace?: 'tranquilo' | 'equilibrado' | 'intenso';

  @ApiPropertyOptional({ enum: ['economico', 'moderado', 'confortavel'], default: 'moderado' })
  @IsOptional()
  @IsIn(['economico', 'moderado', 'confortavel'])
  budget?: 'economico' | 'moderado' | 'confortavel';

  @ApiPropertyOptional({
    maxLength: TEXT_HARD_CAP,
    example: 'Quero lugares com vista e pouca fila.',
    description: 'Limite efetivo configurável (AI_MAX_PROMPT_CHARS, padrão 500); acima dele → 422 AI_REQUEST_TOO_LARGE.',
  })
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(TEXT_HARD_CAP)
  prompt?: string;
}

export class DaySuggestionsRequestDto extends PreferencesDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  dayId: string;
}

export class TripSuggestionsRequestDto extends PreferencesDto {
  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    description:
      'Dias a gerar. Sem este campo, todos os dias da viagem. Máximo AI_MAX_DAYS_PER_GENERATION (padrão 7) → 422 AI_TOO_MANY_DAYS.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(60)
  @IsUUID('all', { each: true })
  dayIds?: string[];
}

export class AdjustItineraryRequestDto {
  @ApiProperty({
    example: 'Deixe o segundo dia mais tranquilo e inclua um almoço perto do museu.',
    maxLength: TEXT_HARD_CAP,
    description: 'Limite efetivo: AI_MAX_PROMPT_CHARS (padrão 500) → 422 AI_REQUEST_TOO_LARGE.',
  })
  @IsString()
  @Transform(trim)
  @MinLength(1)
  @MaxLength(TEXT_HARD_CAP)
  instruction: string;

  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    description: 'Restringe o ajuste a estes dias. Máximo AI_MAX_DAYS_PER_GENERATION (padrão 7) → 422 AI_TOO_MANY_DAYS.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(60)
  @IsUUID('all', { each: true })
  dayIds?: string[];
}

// ───────── Respostas ─────────

class VerificationDto {
  @ApiProperty({ enum: ['UNVERIFIED', 'VERIFIED'], description: 'UNVERIFIED: preços/horários não foram checados' })
  status: 'UNVERIFIED' | 'VERIFIED';

  @ApiProperty({ type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, url: { type: 'string' } } } })
  sources: { title: string; url: string }[];

  @ApiProperty()
  note: string;
}

class EstimatedCostDto {
  @ApiProperty({ type: Number, nullable: true })
  amount: number | null;

  @ApiProperty({ type: String, nullable: true, example: 'EUR' })
  currency: string | null;

  @ApiProperty({ type: String, nullable: true })
  note: string | null;
}

class ProposedActivityDto {
  @ApiProperty()
  title: string;

  @ApiProperty({ example: '10:00' })
  time: string;

  @ApiProperty({ type: Number, nullable: true })
  durationMinutes: number | null;

  @ApiProperty({ enum: ActivityCategory })
  category: ActivityCategory;

  @ApiProperty({ type: String, nullable: true })
  location: string | null;

  @ApiProperty({ type: String, nullable: true })
  notes: string | null;
}

export class SuggestedActivityDto extends ProposedActivityDto {
  @ApiProperty({ format: 'uuid' })
  suggestionId: string;

  @ApiProperty({ format: 'uuid' })
  dayId: string;

  @ApiProperty({ example: '2026-12-21' })
  date: string;

  @ApiProperty()
  reason: string;

  @ApiProperty({ type: EstimatedCostDto, nullable: true })
  estimatedCost: EstimatedCostDto | null;

  @ApiProperty({ type: VerificationDto })
  verification: VerificationDto;
}

export class ProposedChangeDto {
  @ApiProperty({ format: 'uuid' })
  changeId: string;

  @ApiProperty({ enum: ['add', 'update', 'remove'] })
  type: 'add' | 'update' | 'remove';

  @ApiProperty({ format: 'uuid', description: 'Dia de destino' })
  dayId: string;

  @ApiProperty()
  date: string;

  @ApiProperty({ type: String, nullable: true, description: 'Atividade alvo (update/remove)' })
  activityId: string | null;

  @ApiProperty({ type: Number, nullable: true, description: 'Envie como `version` ao aplicar; conflita se a atividade mudou' })
  baseVersion: number | null;

  @ApiProperty({ type: ProposedActivityDto, nullable: true })
  activity: ProposedActivityDto | null;

  @ApiProperty()
  reason: string;

  @ApiProperty({ type: VerificationDto })
  verification: VerificationDto;
}

export class AiJobResultDto {
  @ApiProperty({ enum: ['suggestions', 'adjustment'] })
  type: 'suggestions' | 'adjustment';

  @ApiPropertyOptional({ type: [SuggestedActivityDto] })
  suggestions?: SuggestedActivityDto[];

  @ApiPropertyOptional()
  summary?: string;

  @ApiPropertyOptional({ type: [ProposedChangeDto] })
  changes?: ProposedChangeDto[];

  @ApiProperty({ type: [String] })
  notes: string[];

  @ApiProperty({ description: 'Itens da IA descartados por não passarem na validação' })
  discarded: number;
}

class AiJobErrorDto {
  @ApiProperty({
    enum: [
      'AI_REQUEST_REFUSED',
      'AI_BUDGET_EXHAUSTED',
      'AI_TIMEOUT',
      'AI_RATE_LIMITED',
      'AI_PROVIDER_ERROR',
      'AI_UNAVAILABLE',
      'AI_INVALID_OUTPUT',
      'AI_OUTPUT_TRUNCATED',
      'AI_WORKER_TIMEOUT',
    ],
    description:
      'AI_REQUEST_REFUSED: a IA recusou o pedido (não é repetido automaticamente). AI_BUDGET_EXHAUSTED: uso de IA da viagem esgotado. Em toda falha a cota funcional é liberada.',
  })
  code: string;

  @ApiProperty({ description: 'Mensagem pronta para exibir ao usuário' })
  message: string;
}

class AiTechnicalUsageDto {
  @ApiProperty({ type: String, nullable: true })
  provider: string | null;

  @ApiProperty({ type: String, nullable: true })
  model: string | null;

  @ApiProperty({ type: Number, nullable: true })
  inputTokens: number | null;

  @ApiProperty({ type: Number, nullable: true })
  outputTokens: number | null;

  @ApiProperty()
  attempts: number;
}

export class AiJobDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  tripId: string;

  @ApiProperty({ enum: AiJobKind })
  kind: AiJobKind;

  @ApiProperty({
    enum: AiJobStatus,
    description: 'QUEUED/RUNNING: uso reservado · SUCCEEDED: uso consumido · FAILED: reserva liberada',
  })
  status: AiJobStatus;

  @ApiProperty({ type: 'object', additionalProperties: true, description: 'Escopo e preferências do pedido' })
  input: Record<string, unknown>;

  @ApiProperty({ type: AiJobResultDto, nullable: true, description: 'Sugestões não são aplicadas automaticamente ao roteiro' })
  result: AiJobResultDto | null;

  @ApiProperty({ type: AiJobErrorDto, nullable: true })
  error: AiJobErrorDto | null;

  @ApiProperty({ type: AiTechnicalUsageDto })
  usage: AiTechnicalUsageDto;

  @ApiProperty({ format: 'uuid' })
  requestedById: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ type: Date, nullable: true })
  startedAt: Date | null;

  @ApiProperty({ type: Date, nullable: true })
  finishedAt: Date | null;
}
