import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  ApiBadGatewayResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ErrorResponseDto } from '../../common/errors/error-response.dto';
import { AuthUser, CurrentUser } from '../auth/auth.decorators';
import { PlaceSearchQueryDto, PlaceSearchResultDto } from './dto/location.dto';
import { LocationsService } from './locations.service';

@ApiTags('locations')
@ApiBearerAuth()
@Controller('trips/:tripId/places')
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Get('search')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Busca lugares (autocomplete) para atividades ou para o destino da viagem',
    description:
      'Resultados orientados pela localização confirmada do destino, sem excluir lugares próximos. ' +
      'Nunca escolha automaticamente o primeiro resultado: mostre nome, endereço e cidade para a pessoa confirmar.',
  })
  @ApiOkResponse({ type: PlaceSearchResultDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'FORBIDDEN (VIEWER, ou EDITOR buscando destino)' })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'TRIP_NOT_FOUND' })
  @ApiTooManyRequestsResponse({ type: ErrorResponseDto, description: 'RATE_LIMITED' })
  @ApiBadGatewayResponse({ type: ErrorResponseDto, description: 'LOCATION_PROVIDER_ERROR (falha, timeout ou limite do provedor)' })
  @ApiServiceUnavailableResponse({ type: ErrorResponseDto, description: 'LOCATION_SEARCH_UNAVAILABLE (provedor não configurado)' })
  search(
    @CurrentUser() user: AuthUser,
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Query() query: PlaceSearchQueryDto,
  ): Promise<PlaceSearchResultDto> {
    return this.locations.search(user.id, tripId, query);
  }
}
