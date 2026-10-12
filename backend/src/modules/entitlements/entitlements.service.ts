import { Injectable } from '@nestjs/common';
import { AiQuotaService } from './ai-quota.service';
import type { EntitlementsDto } from './dto/entitlements.dto';
import { MAX_ACTIVITIES_PER_DAY } from './limits';
import { roleCan, TripAccessService } from './trip-access.service';

@Injectable()
export class EntitlementsService {
  constructor(
    private readonly access: TripAccessService,
    private readonly aiQuota: AiQuotaService,
  ) {}

  async forTrip(userId: string, tripId: string): Promise<EntitlementsDto> {
    const { trip, role } = await this.access.require(userId, tripId, 'trip:read');
    const [availability, usage] = await Promise.all([this.aiQuota.availabilityFor(trip.id), this.aiQuota.usage(trip.id)]);
    return {
      tripId: trip.id,
      role,
      maxActivitiesPerDay: MAX_ACTIVITIES_PER_DAY,
      ai: {
        available: availability.available,
        unavailableReason: availability.reason,
        canRequest: availability.available && roleCan(role, 'ai:use'),
        usage,
      },
    };
  }
}
