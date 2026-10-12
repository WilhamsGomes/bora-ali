import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TripRole } from '@prisma/client';

export class AiKindUsageDto {
  @ApiProperty({ example: 30 })
  limit: number;

  @ApiProperty({ example: 2, description: 'Gerações concluídas (consumidas)' })
  used: number;

  @ApiProperty({ example: 0, description: 'Gerações em andamento (reservadas)' })
  reserved: number;

  @ApiProperty({ example: 28 })
  remaining: number;
}

export class AiUsageDto {
  @ApiProperty({ type: AiKindUsageDto })
  DAY_SUGGESTIONS: AiKindUsageDto;

  @ApiProperty({ type: AiKindUsageDto })
  TRIP_SUGGESTIONS: AiKindUsageDto;

  @ApiProperty({ type: AiKindUsageDto })
  ADJUST_ITINERARY: AiKindUsageDto;
}

export class AiEntitlementDto {
  @ApiProperty({ description: 'A IA pode ser usada agora nesta viagem (provedor configurado e limite interno não atingido)' })
  available: boolean;

  @ApiPropertyOptional({
    enum: ['PROVIDER_NOT_CONFIGURED', 'AI_BUDGET_EXHAUSTED'],
    description:
      'PROVIDER_NOT_CONFIGURED: IA indisponível no ambiente. AI_BUDGET_EXHAUSTED: o uso de IA desta viagem chegou ao limite.',
  })
  unavailableReason?: 'PROVIDER_NOT_CONFIGURED' | 'AI_BUDGET_EXHAUSTED';

  @ApiProperty({ description: 'O usuário atual pode solicitar gerações (OWNER/EDITOR)' })
  canRequest: boolean;

  @ApiProperty({ type: AiUsageDto })
  usage: AiUsageDto;
}

export class EntitlementsDto {
  @ApiProperty({ format: 'uuid' })
  tripId: string;

  @ApiProperty({ enum: TripRole })
  role: TripRole;

  @ApiProperty({ example: 10, description: 'Máximo de atividades por dia (fixo na v1)' })
  maxActivitiesPerDay: number;

  @ApiProperty({ type: AiEntitlementDto })
  ai: AiEntitlementDto;

}
