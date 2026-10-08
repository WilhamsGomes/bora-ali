import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ErrorResponseDto } from '../../common/errors/error-response.dto';
import { AuthUser, CurrentUser, Public } from '../auth/auth.decorators';
import { PublicTripDto, ShareLinkDto, UpdateShareLinkDto } from './dto/sharing.dto';
import { SharingService } from './sharing.service';

@ApiTags('sharing')
@Controller()
export class SharingController {
  constructor(private readonly sharing: SharingService) {}

  @Get('trips/:tripId/share')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Configuração do link público (OWNER)' })
  @ApiOkResponse({ type: ShareLinkDto })
  get(@CurrentUser() user: AuthUser, @Param('tripId', ParseUUIDPipe) tripId: string): Promise<ShareLinkDto> {
    return this.sharing.get(user.id, tripId);
  }

  @Put('trips/:tripId/share')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Ativa/desativa o link público e define se observações aparecem (OWNER; PRO/PRO_AI para ativar)' })
  @ApiOkResponse({ type: ShareLinkDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'TRIP_UPGRADE_REQUIRED' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Body() dto: UpdateShareLinkDto,
  ): Promise<ShareLinkDto> {
    return this.sharing.update(user.id, tripId, dto);
  }

  @Post('trips/:tripId/share/rotate')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Renova o token do link (o anterior para de funcionar)' })
  @ApiOkResponse({ type: ShareLinkDto })
  rotate(@CurrentUser() user: AuthUser, @Param('tripId', ParseUUIDPipe) tripId: string): Promise<ShareLinkDto> {
    return this.sharing.rotate(user.id, tripId);
  }

  @Public()
  @Get('public/trips/:token')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Header('Cache-Control', 'private, max-age=60')
  @Header('X-Robots-Tag', 'noindex, nofollow')
  @ApiOperation({ summary: 'Roteiro público somente leitura' })
  @ApiOkResponse({ type: PublicTripDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'SHARE_LINK_NOT_FOUND' })
  getPublic(@Param('token') token: string): Promise<PublicTripDto> {
    return this.sharing.getPublic(token);
  }
}
