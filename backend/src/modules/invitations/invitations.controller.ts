import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ErrorResponseDto } from '../../common/errors/error-response.dto';
import { AuthUser, CurrentUser, Public } from '../auth/auth.decorators';
import {
  AcceptInvitationResultDto,
  CreateInvitationDto,
  InvitationDto,
  InvitationPreviewDto,
  InvitationTokenDto,
  MemberDto,
  UpdateMemberDto,
} from './dto/invitation.dto';
import { InvitationsService } from './invitations.service';

@ApiTags('invitations')
@ApiBearerAuth()
@Controller()
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Post('trips/:tripId/invitations')
  @Throttle({ default: { limit: 20, ttl: 3_600_000 } })
  @ApiOperation({ summary: 'Convida por e-mail como EDITOR ou VIEWER (OWNER; PRO/PRO_AI)' })
  @ApiCreatedResponse({
    type: InvitationDto,
    description: 'Convite criado. Confira delivery.status: FAILED indica que o envio falhou e pode ser repetido via /resend.',
  })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'TRIP_UPGRADE_REQUIRED / FORBIDDEN' })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'ALREADY_MEMBER' })
  @ApiServiceUnavailableResponse({ type: ErrorResponseDto, description: 'EMAIL_DELIVERY_UNAVAILABLE' })
  create(
    @CurrentUser() user: AuthUser,
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Body() dto: CreateInvitationDto,
  ): Promise<InvitationDto> {
    return this.invitations.create(user.id, tripId, dto);
  }

  @Get('trips/:tripId/invitations')
  @ApiOperation({ summary: 'Convites pendentes (OWNER)' })
  @ApiOkResponse({ type: [InvitationDto] })
  list(@CurrentUser() user: AuthUser, @Param('tripId', ParseUUIDPipe) tripId: string): Promise<InvitationDto[]> {
    return this.invitations.list(user.id, tripId);
  }

  @Post('trips/:tripId/invitations/:invitationId/resend')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  @ApiOperation({
    summary: 'Reenvia o mesmo convite (mesmo link), respeitando expiração, revogação e limites de frequência',
    description:
      'Após falha transitória, reaproveita a chave de idempotência (sem e-mail duplicado). Após aceite do provedor, conta como novo envio.',
  })
  @ApiOkResponse({ type: InvitationDto })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'INVITATION_NOT_RESENDABLE / INVITATION_DELIVERY_IN_PROGRESS' })
  @ApiTooManyRequestsResponse({ type: ErrorResponseDto, description: 'INVITATION_RESEND_LIMITED (details.retryAfterSeconds)' })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'INVITATION_RESEND_LIMITED (máximo de envios)' })
  @ApiServiceUnavailableResponse({ type: ErrorResponseDto, description: 'EMAIL_DELIVERY_UNAVAILABLE' })
  resend(
    @CurrentUser() user: AuthUser,
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
  ): Promise<InvitationDto> {
    return this.invitations.resend(user.id, tripId, invitationId);
  }

  @Delete('trips/:tripId/invitations/:invitationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoga um convite pendente (OWNER)' })
  @ApiNoContentResponse()
  revoke(
    @CurrentUser() user: AuthUser,
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
  ): Promise<void> {
    return this.invitations.revoke(user.id, tripId, invitationId);
  }

  @Public()
  @Post('invitations/preview')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Resumo público do convite para a tela de aceite (token no corpo, não na URL)' })
  @ApiOkResponse({ type: InvitationPreviewDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'INVITATION_INVALID' })
  preview(@Body() dto: InvitationTokenDto): Promise<InvitationPreviewDto> {
    return this.invitations.preview(dto.token);
  }

  @Post('invitations/accept')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Aceita o convite com a conta do e-mail convidado' })
  @ApiOkResponse({ type: AcceptInvitationResultDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'INVITATION_EMAIL_MISMATCH / TRIP_UPGRADE_REQUIRED' })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'INVITATION_INVALID' })
  accept(@CurrentUser() user: AuthUser, @Body() dto: InvitationTokenDto): Promise<AcceptInvitationResultDto> {
    return this.invitations.accept(user.id, dto.token);
  }

  // ───────── Participantes ─────────

  @Get('trips/:tripId/members')
  @ApiTags('members')
  @ApiOperation({ summary: 'Participantes da viagem' })
  @ApiOkResponse({ type: [MemberDto] })
  listMembers(@CurrentUser() user: AuthUser, @Param('tripId', ParseUUIDPipe) tripId: string): Promise<MemberDto[]> {
    return this.invitations.listMembers(user.id, tripId);
  }

  @Patch('trips/:tripId/members/:userId')
  @ApiTags('members')
  @ApiOperation({ summary: 'Altera o papel de um convidado (OWNER)' })
  @ApiOkResponse({ type: MemberDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'CANNOT_MODIFY_OWNER / FORBIDDEN' })
  updateMember(
    @CurrentUser() user: AuthUser,
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Param('userId', ParseUUIDPipe) memberUserId: string,
    @Body() dto: UpdateMemberDto,
  ): Promise<MemberDto> {
    return this.invitations.updateMember(user.id, tripId, memberUserId, dto);
  }

  @Delete('trips/:tripId/members/:userId')
  @ApiTags('members')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove um convidado (OWNER) ou sai da viagem (o próprio convidado)' })
  @ApiNoContentResponse()
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'CANNOT_MODIFY_OWNER' })
  removeMember(
    @CurrentUser() user: AuthUser,
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Param('userId', ParseUUIDPipe) memberUserId: string,
  ): Promise<void> {
    return this.invitations.removeMember(user.id, tripId, memberUserId);
  }
}
