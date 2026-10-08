import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
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
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../../common/errors/error-response.dto';
import { AuthUser, CurrentUser } from '../auth/auth.decorators';
import { CreateTripDto, ListTripsQueryDto, TripDetailDto, TripSummaryDto, UpdateTripDto } from './dto/trip.dto';
import { TripsService } from './trips.service';

@ApiTags('trips')
@ApiBearerAuth()
@Controller('trips')
export class TripsController {
  constructor(private readonly trips: TripsService) {}

  @Post()
  @ApiOperation({ summary: 'Cria uma viagem (plano FREE) com um dia para cada data do período' })
  @ApiCreatedResponse({ type: TripDetailDto })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateTripDto): Promise<TripDetailDto> {
    return this.trips.create(user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Lista viagens próprias e recebidas por convite' })
  @ApiOkResponse({ type: [TripSummaryDto] })
  list(@CurrentUser() user: AuthUser, @Query() query: ListTripsQueryDto): Promise<TripSummaryDto[]> {
    return this.trips.list(user.id, query.scope);
  }

  @Get(':tripId')
  @ApiOperation({ summary: 'Detalhe da viagem com dias e atividades' })
  @ApiOkResponse({ type: TripDetailDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  get(@CurrentUser() user: AuthUser, @Param('tripId', ParseUUIDPipe) tripId: string): Promise<TripDetailDto> {
    return this.trips.get(user.id, tripId);
  }

  @Patch(':tripId')
  @ApiOperation({ summary: 'Edita a viagem (OWNER). Mudança de datas pode exigir confirmação.' })
  @ApiOkResponse({ type: TripDetailDto })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'TRIP_DATE_CHANGE_CONFLICT — details.affectedDays lista os dias com atividades fora do novo período',
  })
  @ApiForbiddenResponse({ type: ErrorResponseDto })
  update(
    @CurrentUser() user: AuthUser,
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Body() dto: UpdateTripDto,
  ): Promise<TripDetailDto> {
    return this.trips.update(user.id, tripId, dto);
  }

  @Delete(':tripId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Exclui a viagem (OWNER)' })
  @ApiNoContentResponse()
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'TRIP_HAS_PENDING_PAYMENT' })
  remove(@CurrentUser() user: AuthUser, @Param('tripId', ParseUUIDPipe) tripId: string): Promise<void> {
    return this.trips.remove(user.id, tripId);
  }
}
