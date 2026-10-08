import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../../common/errors/error-response.dto';
import { AuthUser, CurrentUser } from '../auth/auth.decorators';
import {
  ActivityDto,
  ActivityMutationResultDto,
  BatchCreateActivitiesDto,
  BatchCreateResultDto,
  CreateActivityDto,
  DeleteActivityQueryDto,
  ReorderActivitiesDto,
  UpdateActivityDto,
} from './dto/activity.dto';
import { DayDto, UpdateDayDto } from './dto/day.dto';
import { ItineraryService } from './itinerary.service';

@ApiTags('itinerary')
@ApiBearerAuth()
@ApiNotFoundResponse({ type: ErrorResponseDto, description: 'TRIP_NOT_FOUND / DAY_NOT_FOUND / ACTIVITY_NOT_FOUND' })
@Controller('trips/:tripId')
export class ItineraryController {
  constructor(private readonly itinerary: ItineraryService) {}

  @Get('days')
  @ApiOperation({ summary: 'Dias da viagem com atividades ordenadas e avisos de sobreposição' })
  @ApiOkResponse({ type: [DayDto] })
  listDays(@CurrentUser() user: AuthUser, @Param('tripId', ParseUUIDPipe) tripId: string): Promise<DayDto[]> {
    return this.itinerary.listDays(user.id, tripId);
  }

  @Get('days/:dayId')
  @ApiOkResponse({ type: DayDto })
  getDay(
    @CurrentUser() user: AuthUser,
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Param('dayId', ParseUUIDPipe) dayId: string,
  ): Promise<DayDto> {
    return this.itinerary.getDay(user.id, tripId, dayId);
  }

  @Patch('days/:dayId')
  @ApiOperation({ summary: 'Altera o título do dia (OWNER/EDITOR)' })
  @ApiOkResponse({ type: DayDto })
  updateDay(
    @CurrentUser() user: AuthUser,
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Param('dayId', ParseUUIDPipe) dayId: string,
    @Body() dto: UpdateDayDto,
  ): Promise<DayDto> {
    return this.itinerary.updateDay(user.id, tripId, dayId, dto);
  }

  @Post('days/:dayId/activities')
  @ApiOperation({ summary: 'Cria uma atividade no dia (OWNER/EDITOR)' })
  @ApiCreatedResponse({ type: ActivityMutationResultDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'DAILY_ACTIVITY_LIMIT_REACHED / FORBIDDEN' })
  createActivity(
    @CurrentUser() user: AuthUser,
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Param('dayId', ParseUUIDPipe) dayId: string,
    @Body() dto: CreateActivityDto,
  ): Promise<ActivityMutationResultDto> {
    return this.itinerary.createActivity(user.id, tripId, dayId, dto);
  }

  @Put('days/:dayId/activities/order')
  @ApiOperation({ summary: 'Reordena o desempate entre atividades do mesmo horário' })
  @ApiOkResponse({ type: DayDto })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'VERSION_CONFLICT' })
  @ApiUnprocessableEntityResponse({ type: ErrorResponseDto, description: 'INVALID_REORDER' })
  reorder(
    @CurrentUser() user: AuthUser,
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Param('dayId', ParseUUIDPipe) dayId: string,
    @Body() dto: ReorderActivitiesDto,
  ): Promise<DayDto> {
    return this.itinerary.reorder(user.id, tripId, dayId, dto);
  }

  @Post('activities/batch')
  @ApiOperation({ summary: 'Adiciona várias atividades de forma atômica (ex.: aplicar sugestões da IA)' })
  @ApiCreatedResponse({ type: BatchCreateResultDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'DAILY_ACTIVITY_LIMIT_REACHED' })
  batchCreate(
    @CurrentUser() user: AuthUser,
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Body() dto: BatchCreateActivitiesDto,
  ): Promise<BatchCreateResultDto> {
    return this.itinerary.batchCreate(user.id, tripId, dto);
  }

  @Get('activities/:activityId')
  @ApiOkResponse({ type: ActivityDto })
  getActivity(
    @CurrentUser() user: AuthUser,
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Param('activityId', ParseUUIDPipe) activityId: string,
  ): Promise<ActivityDto> {
    return this.itinerary.getActivity(user.id, tripId, activityId);
  }

  @Patch('activities/:activityId')
  @ApiOperation({
    summary: 'Edita ou move a atividade (controle de versão obrigatório)',
    description: 'Alterar o horário ou o dia reposiciona a atividade no fim do novo horário.',
  })
  @ApiOkResponse({ type: ActivityMutationResultDto })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'VERSION_CONFLICT (details.current traz a versão atual)' })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'DAILY_ACTIVITY_LIMIT_REACHED ao mover para dia cheio' })
  updateActivity(
    @CurrentUser() user: AuthUser,
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Param('activityId', ParseUUIDPipe) activityId: string,
    @Body() dto: UpdateActivityDto,
  ): Promise<ActivityMutationResultDto> {
    return this.itinerary.updateActivity(user.id, tripId, activityId, dto);
  }

  @Delete('activities/:activityId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'VERSION_CONFLICT' })
  deleteActivity(
    @CurrentUser() user: AuthUser,
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Param('activityId', ParseUUIDPipe) activityId: string,
    @Query() query: DeleteActivityQueryDto,
  ): Promise<void> {
    return this.itinerary.deleteActivity(user.id, tripId, activityId, query.version);
  }
}
