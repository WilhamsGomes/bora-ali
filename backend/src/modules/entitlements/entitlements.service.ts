import { Injectable } from "@nestjs/common";
import { OrderStatus, TripRole } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { AiQuotaService } from "./ai-quota.service";
import type { EntitlementsDto } from "./dto/entitlements.dto";
import { availableUpgrades, PLAN_FEATURES } from "./plan-policy";
import { roleCan, TripAccessService } from "./trip-access.service";

@Injectable()
export class EntitlementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TripAccessService,
    private readonly aiQuota: AiQuotaService,
  ) {}

  async forTrip(userId: string, tripId: string): Promise<EntitlementsDto> {
    const { trip, role } = await this.access.require(
      userId,
      tripId,
      "trip:read",
    );
    const features = PLAN_FEATURES[trip.plan];
    const availability = await this.aiQuota.availabilityFor(trip.id);
    const [usage, pending] = await Promise.all([
      this.aiQuota.usage(trip.id),
      this.prisma.order.count({
        where: {
          tripId,
          status: {
            in: [OrderStatus.CREATED, OrderStatus.OPEN, OrderStatus.PROCESSING],
          },
        },
      }),
    ]);
    const isOwner = role === TripRole.OWNER;

    return {
      tripId: trip.id,
      plan: trip.plan,
      role,
      maxActivitiesPerDay: features.maxActivitiesPerDay,
      collaboration: features.collaboration,
      publicSharing: features.publicSharing,
      ai: {
        enabled: features.ai,
        available: availability.available,
        unavailableReason: availability.reason,
        canRequest:
          features.ai && availability.available && roleCan(role, "ai:use"),
        usage,
      },
      canPurchase: isOwner,
      availableUpgrades: isOwner ? availableUpgrades(trip.plan) : [],
      hasPendingOrder: pending > 0,
    };
  }
}
