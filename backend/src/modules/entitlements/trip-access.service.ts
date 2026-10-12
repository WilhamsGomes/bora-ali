import { Injectable } from '@nestjs/common';
import { Trip, TripRole } from '@prisma/client';
import { AppError, ErrorCode } from '../../common/errors/app-error';
import { PrismaService, Tx } from '../../prisma/prisma.service';

/** Ações protegidas. O mapeamento papel → ação fica só aqui. */
export type TripAction =
  | 'trip:read'
  | 'trip:manage'
  | 'itinerary:write'
  | 'members:read'
  | 'members:manage'
  | 'share:manage'
  | 'ai:use';

const ROLE_ACTIONS: Record<TripRole, ReadonlySet<TripAction>> = {
  OWNER: new Set<TripAction>([
    'trip:read',
    'trip:manage',
    'itinerary:write',
    'members:read',
    'members:manage',
    'share:manage',
    'ai:use',
  ]),
  EDITOR: new Set<TripAction>(['trip:read', 'itinerary:write', 'members:read', 'ai:use']),
  VIEWER: new Set<TripAction>(['trip:read', 'members:read']),
};


export interface TripAccess {
  trip: Trip;
  role: TripRole;
}

export function roleCan(role: TripRole, action: TripAction): boolean {
  return ROLE_ACTIONS[role].has(action);
}

@Injectable()
export class TripAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Garante que o usuário pode executar a ação na viagem.
   * - Sem vínculo → 404 (não revela a existência da viagem).
   * - Papel insuficiente → 403 FORBIDDEN.
   */
  async require(userId: string, tripId: string, action: TripAction, tx?: Tx): Promise<TripAccess> {
    const db = tx ?? this.prisma;
    const membership = await db.tripMember.findUnique({
      where: { tripId_userId: { tripId, userId } },
      include: { trip: true },
    });
    if (!membership) throw AppError.notFound(ErrorCode.TRIP_NOT_FOUND, 'Viagem não encontrada.');

    const { trip, role } = membership;
    if (!roleCan(role, action)) {
      throw AppError.forbidden(ErrorCode.FORBIDDEN, 'Você não tem permissão para esta ação nesta viagem.', {
        role,
        action,
      });
    }
    return { trip, role };
  }
}
