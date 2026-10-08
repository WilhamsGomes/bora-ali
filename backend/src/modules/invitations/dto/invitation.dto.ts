import { ApiProperty } from '@nestjs/swagger';
import { EmailDeliveryStatus, TripRole } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsString, MaxLength, MinLength } from 'class-validator';

const INVITABLE_ROLES = [TripRole.EDITOR, TripRole.VIEWER] as const;
type InvitableRole = (typeof INVITABLE_ROLES)[number];

export class CreateInvitationDto {
  @ApiProperty({ example: 'bruno@exemplo.com' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiProperty({ enum: INVITABLE_ROLES })
  @IsIn(INVITABLE_ROLES)
  role: InvitableRole;
}

export class InvitationTokenDto {
  @ApiProperty({ description: 'Token recebido no link do convite' })
  @IsString()
  @MinLength(20)
  @MaxLength(200)
  token: string;
}

export class UpdateMemberDto {
  @ApiProperty({ enum: INVITABLE_ROLES })
  @IsIn(INVITABLE_ROLES)
  role: InvitableRole;
}

export class InvitationDeliveryDto {
  @ApiProperty({
    enum: EmailDeliveryStatus,
    description:
      'PENDING: envio pendente/em andamento · PROVIDER_ACCEPTED: aceito pelo provedor de e-mail (não garante entrega na caixa do destinatário) · FAILED: falhou — use POST …/resend',
  })
  status: EmailDeliveryStatus;

  @ApiProperty({ type: String, nullable: true, example: 'resend' })
  provider: string | null;

  @ApiProperty({ description: 'Envios solicitados (inicial + reenvios)' })
  sends: number;

  @ApiProperty({ type: Date, nullable: true })
  lastAttemptAt: Date | null;

  @ApiProperty({ type: Date, nullable: true })
  providerAcceptedAt: Date | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'retryable:rate_limit_exceeded',
    description: 'Código da última falha (prefixo retryable/final). Sem dados sensíveis.',
  })
  errorCode: string | null;
}

export class InvitationDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  tripId: string;

  @ApiProperty()
  email: string;

  @ApiProperty({ enum: TripRole })
  role: TripRole;

  @ApiProperty({ enum: ['PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED'] })
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';

  @ApiProperty()
  expiresAt: Date;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ type: InvitationDeliveryDto })
  delivery: InvitationDeliveryDto;
}

export class InvitationPreviewDto {
  @ApiProperty()
  tripName: string;

  @ApiProperty()
  destination: string;

  @ApiProperty({ example: '2026-12-20' })
  startDate: string;

  @ApiProperty({ example: '2026-12-27' })
  endDate: string;

  @ApiProperty()
  inviterName: string;

  @ApiProperty({ enum: TripRole })
  role: TripRole;

  @ApiProperty({ example: 'br***@exemplo.com', description: 'E-mail convidado, parcialmente oculto' })
  emailHint: string;

  @ApiProperty({ enum: ['PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED'] })
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';

  @ApiProperty()
  expiresAt: Date;
}

export class MemberDto {
  @ApiProperty({ format: 'uuid' })
  userId: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  email: string;

  @ApiProperty({ enum: TripRole })
  role: TripRole;

  @ApiProperty()
  joinedAt: Date;
}

export class AcceptInvitationResultDto {
  @ApiProperty({ format: 'uuid' })
  tripId: string;

  @ApiProperty({ enum: TripRole })
  role: TripRole;
}
