import { Injectable } from '@nestjs/common';
import { OrderStatus, Trip, TripRole } from '@prisma/client';
import { AppError, ErrorCode } from '../../common/errors/app-error';
import { datesInRange, daySpan, fromLocalDate, toLocalDate } from '../../common/utils/local-date';
import { AppConfig } from '../../config/app-config.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PLAN_FEATURES } from '../entitlements/plan-policy';
import { TripAccessService } from '../entitlements/trip-access.service';
import { ItineraryService } from '../itinerary/itinerary.service';
import { resolvePlace, samePlaceText } from '../locations/place';
import type { CreateTripDto, DestinationPlaceDto, TripDetailDto, TripDto, TripSummaryDto, UpdateTripDto } from './dto/trip.dto';

export function toTripDto(trip: Trip, role: TripRole): TripDto {
  return {
    id: trip.id,
    ownerId: trip.ownerId,
    name: trip.name,
    destination: trip.destination,
    startDate: toLocalDate(trip.startDate),
    endDate: toLocalDate(trip.endDate),
    timeZone: trip.timeZone,
    stay: trip.stay,
    coverUrl: trip.coverUrl,
    destinationPlace:
      trip.destinationLatitude != null && trip.destinationLongitude != null
        ? {
            latitude: trip.destinationLatitude,
            longitude: trip.destinationLongitude,
            formattedAddress: trip.destinationFormattedAddress,
            placeId: trip.destinationPlaceId,
            provider: trip.destinationPlaceProvider,
          }
        : null,
    plan: trip.plan,
    role,
    createdAt: trip.createdAt,
    updatedAt: trip.updatedAt,
  };
}

/** Colunas do destino a partir da entrada (null = limpar). Mesmas regras de consistência das atividades. */
function destinationColumns(p: DestinationPlaceDto | null) {
  const place = resolvePlace(
    p
      ? { latitude: p.latitude, longitude: p.longitude, formattedAddress: p.formattedAddress, placeId: p.placeId, placeProvider: p.provider }
      : { latitude: null, longitude: null },
    null,
    false,
  );
  return {
    destinationLatitude: place.latitude,
    destinationLongitude: place.longitude,
    destinationFormattedAddress: place.formattedAddress,
    destinationPlaceId: place.placeId,
    destinationPlaceProvider: place.placeProvider,
  };
}

@Injectable()
export class TripsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TripAccessService,
    private readonly itinerary: ItineraryService,
    private readonly config: AppConfig,
  ) {}

  async create(userId: string, dto: CreateTripDto): Promise<TripDetailDto> {
    this.assertDateRange(dto.startDate, dto.endDate);
    const trip = await this.prisma.$transaction(async (tx) => {
      const created = await tx.trip.create({
        data: {
          ownerId: userId,
          name: dto.name,
          destination: dto.destination,
          startDate: fromLocalDate(dto.startDate),
          endDate: fromLocalDate(dto.endDate),
          timeZone: dto.timeZone,
          stay: dto.stay || null,
          coverUrl: dto.coverUrl || null,
          ...destinationColumns(dto.destinationPlace ?? null),
          members: { create: { userId, role: TripRole.OWNER } },
        },
      });
      await tx.tripDay.createMany({
        data: datesInRange(dto.startDate, dto.endDate).map((date) => ({ tripId: created.id, date: fromLocalDate(date) })),
      });
      return created;
    });
    return { ...toTripDto(trip, TripRole.OWNER), days: await this.itinerary.loadDays(trip) };
  }

  async list(userId: string, scope: 'all' | 'owned' | 'shared' = 'all'): Promise<TripSummaryDto[]> {
    const memberships = await this.prisma.tripMember.findMany({
      where: {
        userId,
        ...(scope === 'owned' ? { role: TripRole.OWNER } : scope === 'shared' ? { role: { not: TripRole.OWNER } } : {}),
      },
      include: {
        trip: {
          include: {
            owner: { select: { name: true } },
            _count: { select: { days: true, activities: true } },
          },
        },
      },
      orderBy: { trip: { startDate: 'asc' } },
    });
    return memberships.map(({ trip, role }) => ({
      ...toTripDto(trip, role),
      dayCount: trip._count.days,
      activityCount: trip._count.activities,
      ownerName: trip.owner.name,
      accessible: role === TripRole.OWNER || PLAN_FEATURES[trip.plan].collaboration,
    }));
  }

  async get(userId: string, tripId: string): Promise<TripDetailDto> {
    const { trip, role } = await this.access.require(userId, tripId, 'trip:read');
    return { ...toTripDto(trip, role), days: await this.itinerary.loadDays(trip) };
  }

  /**
   * Edita a viagem (somente OWNER). Ao mudar datas, dias que continuam no período
   * são preservados, os novos são criados e dias removidos com atividades exigem
   * confirmação explícita em `confirmRemoveDates` (senão 409 TRIP_DATE_CHANGE_CONFLICT).
   */
  async update(userId: string, tripId: string, dto: UpdateTripDto): Promise<TripDetailDto> {
    const trip = await this.prisma.$transaction(async (tx) => {
      const { trip: current } = await this.access.require(userId, tripId, 'trip:manage', tx);
      await this.prisma.lockRows(tx, 'Trip', [tripId]);

      const start = dto.startDate ?? toLocalDate(current.startDate);
      const end = dto.endDate ?? toLocalDate(current.endDate);
      const datesChanged = start !== toLocalDate(current.startDate) || end !== toLocalDate(current.endDate);
      if (datesChanged) {
        this.assertDateRange(start, end);
        await this.itinerary.syncDays(tx, tripId, start, end, dto.confirmRemoveDates);
      }

      // Mudou o texto do destino sem confirmar nova localização: a anterior deixa de valer.
      const destinationChanged = dto.destination !== undefined && !samePlaceText(dto.destination, current.destination);
      const place =
        dto.destinationPlace !== undefined
          ? destinationColumns(dto.destinationPlace)
          : destinationChanged
            ? destinationColumns(null)
            : {};

      return tx.trip.update({
        where: { id: tripId },
        data: {
          ...place,
          name: dto.name,
          destination: dto.destination,
          timeZone: dto.timeZone,
          startDate: fromLocalDate(start),
          endDate: fromLocalDate(end),
          ...(dto.stay !== undefined ? { stay: dto.stay || null } : {}),
          ...(dto.coverUrl !== undefined ? { coverUrl: dto.coverUrl || null } : {}),
        },
      });
    });
    return { ...toTripDto(trip, TripRole.OWNER), days: await this.itinerary.loadDays(trip) };
  }

  async remove(userId: string, tripId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.access.require(userId, tripId, 'trip:manage', tx);
      await this.prisma.lockRows(tx, 'Trip', [tripId]);
      const pending = await tx.order.count({
        where: { tripId, status: { in: [OrderStatus.CREATED, OrderStatus.OPEN, OrderStatus.PROCESSING] } },
      });
      if (pending > 0) {
        throw AppError.conflict(
          ErrorCode.TRIP_HAS_PENDING_PAYMENT,
          'Há um pagamento em andamento para esta viagem. Aguarde a conclusão antes de excluí-la.',
        );
      }
      // Pedidos são mantidos (tripId vira nulo) para fins contábeis.
      await tx.trip.delete({ where: { id: tripId } });
    });
  }

  private assertDateRange(start: string, end: string) {
    if (end < start) {
      throw AppError.badRequest(ErrorCode.INVALID_DATE_RANGE, 'A data final deve ser igual ou posterior à inicial.');
    }
    const max = this.config.get('MAX_TRIP_DAYS');
    if (daySpan(start, end) > max) {
      throw AppError.badRequest(ErrorCode.TRIP_TOO_LONG, `Uma viagem pode ter no máximo ${max} dias.`, { maxDays: max });
    }
  }
}
