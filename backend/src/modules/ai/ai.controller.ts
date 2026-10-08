import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { ErrorResponseDto } from '../../common/errors/error-response.dto';
import { AuthUser, CurrentUser } from '../auth/auth.decorators';
import { AiEntitlementDto } from '../entitlements/dto/entitlements.dto';
import { AiJobsService } from './ai-jobs.service';
import { JobInput } from './ai.schemas';
import {
  AdjustItineraryRequestDto,
  AiJobDto,
  DaySuggestionsRequestDto,
  PreferencesDto,
  TripSuggestionsRequestDto,
} from './dto/ai.dto';

const IDEMPOTENCY_HEADER = {
  name: 'Idempotency-Key',
  required: false,
  description: 'Recomendado. Repetir a mesma chave devolve o mesmo trabalho em vez de consumir outra geração.',
};

function preferences(dto: PreferencesDto) {
  return {
    interests: dto.interests ?? [],
    pace: dto.pace ?? 'equilibrado',
    budget: dto.budget ?? 'moderado',
    ...(dto.prompt ? { prompt: dto.prompt } : {}),
  };
}

@ApiTags('ai')
@ApiBearerAuth()
@Controller('trips/:tripId/ai')
export class AiController {
  constructor(private readonly jobs: AiJobsService) {}

  @Get('usage')
  @ApiOperation({ summary: 'Disponibilidade, limites e consumo de IA da viagem' })
  @ApiOkResponse({ type: AiEntitlementDto })
  usage(@CurrentUser() user: AuthUser, @Param('tripId', ParseUUIDPipe) tripId: string): Promise<AiEntitlementDto> {
    return this.jobs.status(user.id, tripId);
  }

  @Post('day-suggestions')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiOperation({ summary: 'Gera sugestões para um dia (assíncrono; OWNER/EDITOR; PRO_AI)' })
  @ApiAcceptedResponse({ type: AiJobDto })
  @ApiOkResponse({ type: AiJobDto, description: 'Mesma Idempotency-Key: trabalho existente' })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'TRIP_UPGRADE_REQUIRED / AI_USAGE_LIMIT_REACHED / FORBIDDEN' })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'AI_JOB_IN_PROGRESS' })
  @ApiServiceUnavailableResponse({ type: ErrorResponseDto, description: 'AI_UNAVAILABLE' })
  daySuggestions(
    @CurrentUser() user: AuthUser,
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Body() dto: DaySuggestionsRequestDto,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AiJobDto> {
    return this.enqueue(user, tripId, { kind: 'DAY_SUGGESTIONS', dayId: dto.dayId, preferences: preferences(dto) }, key, res);
  }

  @Post('trip-suggestions')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiOperation({ summary: 'Gera sugestões para a viagem inteira (assíncrono; acompanhe pelo trabalho)' })
  @ApiAcceptedResponse({ type: AiJobDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'TRIP_UPGRADE_REQUIRED / AI_USAGE_LIMIT_REACHED' })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'AI_JOB_IN_PROGRESS' })
  @ApiServiceUnavailableResponse({ type: ErrorResponseDto, description: 'AI_UNAVAILABLE' })
  tripSuggestions(
    @CurrentUser() user: AuthUser,
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Body() dto: TripSuggestionsRequestDto,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AiJobDto> {
    return this.enqueue(
      user,
      tripId,
      { kind: 'TRIP_SUGGESTIONS', preferences: preferences(dto), ...(dto.dayIds ? { dayIds: dto.dayIds } : {}) },
      key,
      res,
    );
  }

  @Post('adjustments')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiOperation({
    summary: 'Propõe ajustes ao roteiro existente (assíncrono)',
    description: 'O resultado é uma lista de mudanças propostas; nada é aplicado automaticamente.',
  })
  @ApiAcceptedResponse({ type: AiJobDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'TRIP_UPGRADE_REQUIRED / AI_USAGE_LIMIT_REACHED' })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'AI_JOB_IN_PROGRESS' })
  adjustments(
    @CurrentUser() user: AuthUser,
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Body() dto: AdjustItineraryRequestDto,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AiJobDto> {
    return this.enqueue(
      user,
      tripId,
      { kind: 'ADJUST_ITINERARY', instruction: dto.instruction, ...(dto.dayIds ? { dayIds: dto.dayIds } : {}) },
      key,
      res,
    );
  }

  @Get('jobs')
  @ApiOperation({ summary: 'Últimos trabalhos de IA da viagem' })
  @ApiOkResponse({ type: [AiJobDto] })
  list(@CurrentUser() user: AuthUser, @Param('tripId', ParseUUIDPipe) tripId: string): Promise<AiJobDto[]> {
    return this.jobs.list(user.id, tripId);
  }

  @Get('jobs/:jobId')
  @ApiOperation({ summary: 'Status e resultado de um trabalho de IA (polling)' })
  @ApiOkResponse({ type: AiJobDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'AI_JOB_NOT_FOUND' })
  get(
    @CurrentUser() user: AuthUser,
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ): Promise<AiJobDto> {
    return this.jobs.get(user.id, tripId, jobId);
  }

  private async enqueue(user: AuthUser, tripId: string, input: JobInput, key: string | undefined, res: Response) {
    const { job, created } = await this.jobs.request(user.id, tripId, input, key);
    res.status(created ? 202 : 200);
    res.setHeader('Location', `/api/v1/trips/${tripId}/ai/jobs/${job.id}`);
    return job;
  }
}
