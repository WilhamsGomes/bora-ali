import { withFields } from '../../common/logging';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { EmailDeliveryStatus, Invitation, Trip, TripRole } from '@prisma/client';
import { randomBytes, randomUUID } from 'node:crypto';
import { AppError, ErrorCode } from '../../common/errors/app-error';
import { toLocalDate } from '../../common/utils/local-date';
import { hashToken } from '../../common/utils/secure-token';
import { AppConfig } from '../../config/app-config.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TripAccessService } from '../entitlements/trip-access.service';
import { MailDeliveryError, MailSender } from '../mail/mail.service';
import { renderInvitationEmail } from '../mail/templates/invitation.template';
import type {
  AcceptInvitationResultDto,
  CreateInvitationDto,
  InvitationDto,
  InvitationPreviewDto,
  MemberDto,
  UpdateMemberDto,
} from './dto/invitation.dto';
import { deriveInvitationToken, invitationTokenKey } from './invitation-token';

const INVITATION_TTL_MS = 7 * 86_400_000;
/** Um envio PENDING mais antigo que isto é considerado interrompido e pode ser retomado. */
const STALE_SENDING_MS = 2 * 60_000;

function invitationStatus(inv: Invitation): InvitationDto['status'] {
  if (inv.acceptedAt) return 'ACCEPTED';
  if (inv.revokedAt) return 'REVOKED';
  if (inv.expiresAt <= new Date()) return 'EXPIRED';
  return 'PENDING';
}

function toInvitationDto(inv: Invitation): InvitationDto {
  return {
    id: inv.id,
    tripId: inv.tripId,
    email: inv.email,
    role: inv.role,
    status: invitationStatus(inv),
    expiresAt: inv.expiresAt,
    createdAt: inv.createdAt,
    delivery: {
      status: inv.deliveryStatus,
      provider: inv.deliveryProvider,
      sends: inv.deliverySeq,
      lastAttemptAt: inv.lastDeliveryAttemptAt,
      providerAcceptedAt: inv.providerAcceptedAt,
      errorCode: inv.deliveryErrorCode,
    },
  };
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  return `${local.slice(0, 2)}***@${domain}`;
}

@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);
  private readonly tokenKey: Buffer;

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TripAccessService,
    private readonly mail: MailSender,
    private readonly config: AppConfig,
  ) {
    this.tokenKey = invitationTokenKey(config.get('JWT_ACCESS_SECRET'));
  }

  /**
   * Cria o convite (estado de entrega PENDING) e tenta enviá-lo. Se o envio
   * falhar, o convite continua válido com entrega FAILED e pode ser reenviado
   * por `resend` — sem criar outro convite nem trocar o link.
   */
  async create(userId: string, tripId: string, dto: CreateInvitationDto): Promise<InvitationDto> {
    this.assertMailConfigured();
    const invitation = await this.prisma.$transaction(async (tx) => {
      await this.access.require(userId, tripId, 'members:manage', tx);
      const existingMember = await tx.tripMember.findFirst({ where: { tripId, user: { email: dto.email } } });
      if (existingMember) {
        throw AppError.conflict(ErrorCode.ALREADY_MEMBER, 'Esta pessoa já participa da viagem.');
      }

      // Um convite pendente por e-mail: o novo substitui o anterior (o link antigo deixa de valer).
      await tx.invitation.updateMany({
        where: { tripId, email: dto.email, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      const id = randomUUID();
      const nonce = randomBytes(16).toString('base64url');
      return tx.invitation.create({
        data: {
          id,
          tripId,
          email: dto.email,
          role: dto.role,
          tokenNonce: nonce,
          tokenHash: hashToken(deriveInvitationToken(this.tokenKey, id, nonce)),
          invitedById: userId,
          expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
          deliveryStatus: EmailDeliveryStatus.PENDING,
          deliveryProvider: this.mail.provider,
          lastSendRequestedAt: new Date(),
        },
      });
    });
    return toInvitationDto(await this.deliver(invitation));
  }

  /**
   * Reenvia o mesmo convite (mesmo link). Respeita expiração, revogação,
   * intervalo mínimo e número máximo de envios.
   * - Após falha transitória/ambígua, reaproveita a mesma chave de idempotência
   *   (se o provedor já tinha aceitado, não sai um e-mail duplicado).
   * - Após aceite pelo provedor ou falha definitiva, abre um novo envio (nova chave).
   */
  async resend(userId: string, tripId: string, invitationId: string): Promise<InvitationDto> {
    this.assertMailConfigured();
    await this.access.require(userId, tripId, 'members:manage');
    const inv = await this.prisma.invitation.findFirst({ where: { id: invitationId, tripId } });
    if (!inv) throw AppError.notFound(ErrorCode.NOT_FOUND, 'Convite não encontrado.');
    if (invitationStatus(inv) !== 'PENDING') {
      throw AppError.conflict(ErrorCode.INVITATION_NOT_RESENDABLE, 'Este convite não está mais pendente (aceito, revogado ou expirado).', {
        status: invitationStatus(inv),
      });
    }
    if (!inv.tokenNonce) {
      throw AppError.conflict(ErrorCode.INVITATION_NOT_RESENDABLE, 'Este convite é antigo e não pode ser reenviado. Crie um novo convite.');
    }

    const now = Date.now();
    const inFlight =
      inv.deliveryStatus === EmailDeliveryStatus.PENDING &&
      inv.lastDeliveryAttemptAt &&
      now - inv.lastDeliveryAttemptAt.getTime() < STALE_SENDING_MS;
    if (inFlight) {
      throw AppError.conflict(ErrorCode.INVITATION_DELIVERY_IN_PROGRESS, 'O envio deste convite está em andamento.');
    }

    // Retomada de uma tentativa ambígua: mesma chave. Caso contrário, novo envio.
    const sameIntent =
      inv.deliveryStatus === EmailDeliveryStatus.PENDING ||
      (inv.deliveryStatus === EmailDeliveryStatus.FAILED && inv.deliveryErrorCode?.startsWith('retryable:'));
    if (!sameIntent) {
      const maxSends = this.config.get('INVITATION_MAX_SENDS');
      if (inv.deliverySeq >= maxSends) {
        throw AppError.forbidden(ErrorCode.INVITATION_RESEND_LIMITED, `Este convite já foi enviado ${maxSends} vezes.`, {
          maxSends,
        });
      }
    }
    const minIntervalMs = this.config.get('INVITATION_RESEND_MIN_INTERVAL_SECONDS') * 1000;
    const last = inv.lastSendRequestedAt?.getTime() ?? 0;
    if (now - last < minIntervalMs) {
      const retryAfterSeconds = Math.ceil((minIntervalMs - (now - last)) / 1000);
      throw new AppError(HttpStatus.TOO_MANY_REQUESTS, ErrorCode.INVITATION_RESEND_LIMITED, 'Aguarde um pouco antes de reenviar este convite.', {
        retryAfterSeconds,
      });
    }

    // Reivindicação condicional: protege contra cliques duplos concorrentes.
    const claimed = await this.prisma.invitation.updateMany({
      where: { id: inv.id, deliverySeq: inv.deliverySeq, deliveryStatus: inv.deliveryStatus, lastSendRequestedAt: inv.lastSendRequestedAt },
      data: {
        deliveryStatus: EmailDeliveryStatus.PENDING,
        deliverySeq: sameIntent ? inv.deliverySeq : inv.deliverySeq + 1,
        deliveryErrorCode: null,
        deliveryProvider: this.mail.provider,
        lastSendRequestedAt: new Date(),
      },
    });
    if (claimed.count !== 1) {
      throw AppError.conflict(ErrorCode.INVITATION_DELIVERY_IN_PROGRESS, 'O envio deste convite está em andamento.');
    }
    return toInvitationDto(await this.deliver(await this.prisma.invitation.findUniqueOrThrow({ where: { id: inv.id } })));
  }

  /**
   * Envia o e-mail do convite com a chave `invitation/<id>/send-<seq>`.
   * PROVIDER_ACCEPTED significa aceito pelo provedor — não entregue ao destinatário.
   * Nunca registra token, link ou conteúdo do e-mail em log.
   */
  private async deliver(inv: Invitation): Promise<Invitation> {
    const trip = await this.prisma.trip.findUniqueOrThrow({ where: { id: inv.tripId } });
    const inviter = await this.prisma.user.findUniqueOrThrow({ where: { id: inv.invitedById }, select: { name: true } });
    const email = this.buildEmail(inv, trip, inviter.name);

    await this.prisma.invitation.update({
      where: { id: inv.id },
      data: { lastDeliveryAttemptAt: new Date(), deliveryAttempts: { increment: 1 } },
    });
    try {
      const sent = await this.mail.send(email, { idempotencyKey: `invitation/${inv.id}/send-${inv.deliverySeq}` });
      return await this.prisma.invitation.update({
        where: { id: inv.id },
        data: {
          deliveryStatus: EmailDeliveryStatus.PROVIDER_ACCEPTED,
          providerAcceptedAt: new Date(),
          providerMessageId: sent.providerMessageId,
          deliveryErrorCode: null,
        },
      });
    } catch (err) {
      const e = err instanceof MailDeliveryError ? err : new MailDeliveryError('unexpected_error', 'Falha inesperada.', true);
      this.logger.warn(withFields('Falha ao enviar convite por e-mail', { invitationId: inv.id, provider: this.mail.provider, code: e.code, httpStatus: e.options.httpStatus ?? null }));
      // Prefixo indica se a próxima tentativa deve reaproveitar a mesma chave.
      const reuseKey = e.retryable && !e.options.sameKeyUnusable;
      return this.prisma.invitation.update({
        where: { id: inv.id },
        data: {
          deliveryStatus: EmailDeliveryStatus.FAILED,
          deliveryErrorCode: `${reuseKey ? 'retryable' : 'final'}:${e.code}`.slice(0, 100),
        },
      });
    }
  }

  private buildEmail(inv: Invitation, trip: Trip, inviterName: string) {
    const token = deriveInvitationToken(this.tokenKey, inv.id, inv.tokenNonce!);
    const { subject, html, text } = renderInvitationEmail({
      tripName: trip.name,
      destination: trip.destination,
      inviterName,
      role: inv.role,
      expiresAt: inv.expiresAt,
      acceptUrl: `${this.config.get('FRONTEND_URL')}/convites/${encodeURIComponent(token)}`,
    });
    return { to: inv.email, subject, html, text, tags: { type: 'invitation' } };
  }

  private assertMailConfigured() {
    if (!this.mail.isConfigured) {
      throw AppError.unavailable(
        ErrorCode.EMAIL_DELIVERY_UNAVAILABLE,
        'O envio de convites não está disponível: nenhum provedor de e-mail configurado.',
      );
    }
  }

  async list(userId: string, tripId: string): Promise<InvitationDto[]> {
    await this.access.require(userId, tripId, 'trip:manage');
    const invitations = await this.prisma.invitation.findMany({
      where: { tripId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    return invitations.map(toInvitationDto);
  }

  async revoke(userId: string, tripId: string, invitationId: string): Promise<void> {
    await this.access.require(userId, tripId, 'trip:manage');
    const res = await this.prisma.invitation.updateMany({
      where: { id: invitationId, tripId, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (res.count === 0) throw AppError.notFound(ErrorCode.NOT_FOUND, 'Convite pendente não encontrado.');
  }

  /** Informações mínimas para a tela de aceite (sem dados do roteiro). */
  async preview(token: string): Promise<InvitationPreviewDto> {
    const inv = await this.prisma.invitation.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { trip: true, invitedBy: { select: { name: true } } },
    });
    if (!inv) throw AppError.notFound(ErrorCode.INVITATION_INVALID, 'Convite inválido.');
    return {
      tripName: inv.trip.name,
      destination: inv.trip.destination,
      startDate: toLocalDate(inv.trip.startDate),
      endDate: toLocalDate(inv.trip.endDate),
      inviterName: inv.invitedBy.name,
      role: inv.role,
      emailHint: maskEmail(inv.email),
      status: invitationStatus(inv),
      expiresAt: inv.expiresAt,
    };
  }

  /**
   * Aceite autenticado. Exige que o e-mail da conta seja o e-mail convidado,
   * que o convite esteja vigente e que o plano da viagem permita colaboração.
   */
  async accept(userId: string, token: string): Promise<AcceptInvitationResultDto> {
    return this.prisma.$transaction(async (tx) => {
      const inv = await tx.invitation.findUnique({ where: { tokenHash: hashToken(token) }, include: { trip: true } });
      if (!inv || invitationStatus(inv) !== 'PENDING') {
        throw AppError.notFound(ErrorCode.INVITATION_INVALID, 'Convite inválido, expirado ou já utilizado.');
      }
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      if (user.email !== inv.email) {
        throw AppError.forbidden(
          ErrorCode.INVITATION_EMAIL_MISMATCH,
          'Este convite foi enviado para outro e-mail. Entre com a conta do e-mail convidado.',
          { emailHint: maskEmail(inv.email) },
        );
      }
      this.access.requireFeature(inv.trip, 'collaboration');

      // Marca o convite como usado de forma condicional (protege contra aceite duplo concorrente).
      const used = await tx.invitation.updateMany({
        where: { id: inv.id, acceptedAt: null, revokedAt: null },
        data: { acceptedAt: new Date(), acceptedById: userId },
      });
      if (used.count !== 1) throw AppError.notFound(ErrorCode.INVITATION_INVALID, 'Convite já utilizado.');

      // Sem participantes duplicados; um papel existente nunca é rebaixado nem o OWNER alterado.
      const existing = await tx.tripMember.findUnique({ where: { tripId_userId: { tripId: inv.tripId, userId } } });
      if (existing) return { tripId: inv.tripId, role: existing.role };
      const member = await tx.tripMember.create({ data: { tripId: inv.tripId, userId, role: inv.role } });
      return { tripId: inv.tripId, role: member.role };
    });
  }

  // ───────────────────────────── Participantes ─────────────────────────────

  async listMembers(userId: string, tripId: string): Promise<MemberDto[]> {
    await this.access.require(userId, tripId, 'members:read');
    const members = await this.prisma.tripMember.findMany({
      where: { tripId },
      include: { user: { select: { name: true, email: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return members.map((m) => ({
      userId: m.userId,
      name: m.user.name,
      email: m.user.email,
      role: m.role,
      joinedAt: m.createdAt,
    }));
  }

  async updateMember(userId: string, tripId: string, memberUserId: string, dto: UpdateMemberDto): Promise<MemberDto> {
    await this.access.require(userId, tripId, 'members:manage');
    const member = await this.findMember(tripId, memberUserId);
    if (member.role === TripRole.OWNER) {
      throw AppError.forbidden(ErrorCode.CANNOT_MODIFY_OWNER, 'O papel do proprietário não pode ser alterado.');
    }
    const updated = await this.prisma.tripMember.update({
      where: { id: member.id },
      data: { role: dto.role },
      include: { user: { select: { name: true, email: true } } },
    });
    return {
      userId: updated.userId,
      name: updated.user.name,
      email: updated.user.email,
      role: updated.role,
      joinedAt: updated.createdAt,
    };
  }

  /** O proprietário remove qualquer convidado; um convidado pode sair da viagem. O OWNER nunca é removido. */
  async removeMember(userId: string, tripId: string, memberUserId: string): Promise<void> {
    const member = await this.findMember(tripId, memberUserId).catch(() => null);
    const isSelf = userId === memberUserId;
    if (!isSelf || !member) await this.access.require(userId, tripId, 'trip:manage');
    if (!member) throw AppError.notFound(ErrorCode.NOT_FOUND, 'Participante não encontrado.');
    if (member.role === TripRole.OWNER) {
      throw AppError.forbidden(ErrorCode.CANNOT_MODIFY_OWNER, 'O proprietário não pode ser removido da viagem.');
    }
    await this.prisma.tripMember.delete({ where: { id: member.id } });
  }

  private async findMember(tripId: string, userId: string) {
    const member = await this.prisma.tripMember.findUnique({ where: { tripId_userId: { tripId, userId } } });
    if (!member) throw AppError.notFound(ErrorCode.NOT_FOUND, 'Participante não encontrado.');
    return member;
  }
}
