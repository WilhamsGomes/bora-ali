import { Injectable } from '@nestjs/common';
import { Trip, TripRole } from '@prisma/client';
import { AppError, ErrorCode } from '../../common/errors/app-error';
import { PrismaService, Tx } from '../../prisma/prisma.service';
import { availableUpgrades, Feature, PLAN_FEATURES, plansWith } from './plan-policy';

/** Ações protegidas. O mapeamento papel → ação fica só aqui. */
export type TripAction =
  | 'trip:read'
  | 'trip:manage'
  | 'itinerary:write'
  | 'members:read'
  | 'members:manage'
  | 'share:manage'
  | 'billing:purchase'
  | 'ai:use';

const ROLE_ACTIONS: Record<TripRole, ReadonlySet<TripAction>> = {
  OWNER: new Set<TripAction>([
    'trip:read',
    'trip:manage',
    'itinerary:write',
    'members:read',
    'members:manage',
    'share:manage',
    'billing:purchase',
    'ai:use',
  ]),
  EDITOR: new Set<TripAction>(['trip:read', 'itinerary:write', 'members:read', 'ai:use']),
  VIEWER: new Set<TripAction>(['trip:read', 'members:read']),
};

/** Recurso de plano exigido por ação (além do papel). */
const ACTION_FEATURE: Partial<Record<TripAction, Feature>> = {
  'members:manage': 'collaboration',
  'share:manage': 'publicSharing',
  'ai:use': 'ai',
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
   * - Convidado em viagem cujo plano não permite colaboração (ex.: após reembolso) → 403 TRIP_UPGRADE_REQUIRED.
   * - Recurso do plano ausente → 403 TRIP_UPGRADE_REQUIRED.
   */
  async require(userId: string, tripId: string, action: TripAction, tx?: Tx): Promise<TripAccess> {
    const db = tx ?? this.prisma;
    const membership = await db.tripMember.findUnique({
      where: { tripId_userId: { tripId, userId } },
      include: { trip: true },
    });
    if (!membership) throw AppError.notFound(ErrorCode.TRIP_NOT_FOUND, 'Viagem não encontrada.');

    const { trip, role } = membership;
    if (role !== TripRole.OWNER && !PLAN_FEATURES[trip.plan].collaboration) {
      throw AppError.forbidden(
        ErrorCode.TRIP_UPGRADE_REQUIRED,
        'A colaboração desta viagem está suspensa: o plano atual não inclui colaboração.',
        { feature: 'collaboration', currentPlan: trip.plan, requiredPlans: plansWith('collaboration') },
      );
    }
    if (!roleCan(role, action)) {
      throw AppError.forbidden(ErrorCode.FORBIDDEN, 'Você não tem permissão para esta ação nesta viagem.', {
        role,
        action,
      });
    }
    const feature = ACTION_FEATURE[action];
    if (feature) this.requireFeature(trip, feature);
    return { trip, role };
  }

  requireFeature(trip: Pick<Trip, 'plan'>, feature: Feature): void {
    if (PLAN_FEATURES[trip.plan][feature]) return;
    const messages: Record<Feature, string> = {
      collaboration: 'Convites e colaboração exigem o plano PRO ou PRO + IA.',
      publicSharing: 'O link público exige o plano PRO ou PRO + IA.',
      ai: 'A geração com IA exige o plano PRO + IA.',
    };
    throw AppError.forbidden(ErrorCode.TRIP_UPGRADE_REQUIRED, messages[feature], {
      feature,
      currentPlan: trip.plan,
      requiredPlans: plansWith(feature),
      availableUpgrades: availableUpgrades(trip.plan),
    });
  }
}
