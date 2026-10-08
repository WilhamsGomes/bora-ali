import { Injectable } from '@nestjs/common';
import { Activity, ActivityCategory, Prisma, Trip } from '@prisma/client';
import { AppError, ErrorCode } from '../../common/errors/app-error';
import { datesInRange, fromLocalDate, toLocalDate } from '../../common/utils/local-date';
import { timeToMinutes } from '../../common/utils/local-time';
import { PrismaService, Tx } from '../../prisma/prisma.service';
import { availableUpgrades, PLAN_FEATURES } from '../entitlements/plan-policy';
import { TripAccessService } from '../entitlements/trip-access.service';
import { resolvePlace, samePlaceText } from '../locations/place';
import type {
  ActivityDto,
  ActivityInputDto,
  ActivityMutationResultDto,
  BatchCreateActivitiesDto,
  BatchCreateResultDto,
  ReorderActivitiesDto,
  UpdateActivityDto,
} from './dto/activity.dto';
import type { DayDto, UpdateDayDto } from './dto/day.dto';
import { computeOverlaps, sortActivities, toActivityDto, toDayDto } from './itinerary.mapper';

export interface AffectedDay {
  dayId: string;
  date: string;
  activityCount: number;
}

@Injectable()
export class ItineraryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TripAccessService,
  ) {}

  // ───────────────────────────── Leitura ─────────────────────────────

  async listDays(userId: string, tripId: string): Promise<DayDto[]> {
    const { trip } = await this.access.require(userId, tripId, 'trip:read');
    return this.loadDays(trip);
  }

  async loadDays(trip: Pick<Trip, 'id' | 'plan'>, db: Tx | PrismaService = this.prisma): Promise<DayDto[]> {
    const days = await db.tripDay.findMany({
      where: { tripId: trip.id },
      include: { activities: true },
      orderBy: { date: 'asc' },
    });
    const max = PLAN_FEATURES[trip.plan].maxActivitiesPerDay;
    return days.map((d) => toDayDto(d, max));
  }

  async getDay(userId: string, tripId: string, dayId: string): Promise<DayDto> {
    const { trip } = await this.access.require(userId, tripId, 'trip:read');
    return this.dayDto(this.prisma, trip, dayId);
  }

  async getActivity(userId: string, tripId: string, activityId: string): Promise<ActivityDto> {
    await this.access.require(userId, tripId, 'trip:read');
    return toActivityDto(await this.findActivity(this.prisma, tripId, activityId));
  }

  async updateDay(userId: string, tripId: string, dayId: string, dto: UpdateDayDto): Promise<DayDto> {
    const { trip } = await this.access.require(userId, tripId, 'itinerary:write');
    await this.findDay(this.prisma, tripId, dayId);
    if (dto.title !== undefined) {
      await this.prisma.tripDay.update({ where: { id: dayId }, data: { title: dto.title || null } });
    }
    return this.dayDto(this.prisma, trip, dayId);
  }

  // ───────────────────────────── Escrita ─────────────────────────────

  async createActivity(
    userId: string,
    tripId: string,
    dayId: string,
    dto: ActivityInputDto,
  ): Promise<ActivityMutationResultDto> {
    return this.prisma.$transaction(async (tx) => {
      const { trip } = await this.access.require(userId, tripId, 'itinerary:write', tx);
      const day = await this.findDay(tx, tripId, dayId);
      await this.prisma.lockRows(tx, 'TripDay', [day.id]);
      await this.assertCapacity(tx, trip, [{ dayId: day.id, adding: 1 }]);

      const data = this.toData(dto);
      const position = await this.nextPosition(tx, day.id, data.startMinutes);
      const activity = await tx.activity.create({
        data: { ...data, tripId, dayId: day.id, position, createdById: userId, updatedById: userId },
      });
      return { activity: toActivityDto(activity), warnings: await this.warningsFor(tx, day.id, [activity.id]) };
    });
  }

  /** Adição em lote atômica: ou todas as atividades entram, ou nenhuma. */
  async batchCreate(userId: string, tripId: string, dto: BatchCreateActivitiesDto): Promise<BatchCreateResultDto> {
    return this.prisma.$transaction(async (tx) => {
      const { trip } = await this.access.require(userId, tripId, 'itinerary:write', tx);
      const dayIds = [...new Set(dto.items.map((i) => i.dayId))];
      const days = await tx.tripDay.findMany({ where: { id: { in: dayIds }, tripId }, select: { id: true } });
      if (days.length !== dayIds.length) {
        throw AppError.notFound(ErrorCode.DAY_NOT_FOUND, 'Um ou mais dias não pertencem a esta viagem.');
      }
      await this.prisma.lockRows(tx, 'TripDay', dayIds);
      await this.assertCapacity(
        tx,
        trip,
        dayIds.map((id) => ({ dayId: id, adding: dto.items.filter((i) => i.dayId === id).length })),
      );

      const created: Activity[] = [];
      for (const item of dto.items) {
        const data = this.toData(item);
        const position = await this.nextPosition(tx, item.dayId, data.startMinutes);
        created.push(
          await tx.activity.create({
            data: { ...data, tripId, dayId: item.dayId, position, createdById: userId, updatedById: userId },
          }),
        );
      }
      const ids = created.map((a) => a.id);
      const warnings = (await Promise.all(dayIds.map((d) => this.warningsFor(tx, d, ids)))).flat();
      return { activities: created.map(toActivityDto), warnings };
    });
  }

  async updateActivity(
    userId: string,
    tripId: string,
    activityId: string,
    dto: UpdateActivityDto,
  ): Promise<ActivityMutationResultDto> {
    return this.prisma.$transaction(async (tx) => {
      const { trip } = await this.access.require(userId, tripId, 'itinerary:write', tx);
      const current = await this.findActivity(tx, tripId, activityId);
      this.assertVersion(current, dto.version);

      const targetDayId = dto.dayId ?? current.dayId;
      const moving = targetDayId !== current.dayId;
      if (moving) await this.findDay(tx, tripId, targetDayId);
      await this.prisma.lockRows(tx, 'TripDay', [current.dayId, targetDayId]);
      if (moving) await this.assertCapacity(tx, trip, [{ dayId: targetDayId, adding: 1 }]);

      const { version: _v, dayId: _d, ...fields } = dto;
      const data = this.toPartialData(fields, current);
      const startMinutes = data.startMinutes ?? current.startMinutes;
      const repositioned = moving || startMinutes !== current.startMinutes;
      const position = repositioned ? await this.nextPosition(tx, targetDayId, startMinutes) : current.position;

      // Atualização condicional pela versão: protege contra corrida entre a leitura e a escrita.
      const res = await tx.activity.updateMany({
        where: { id: activityId, version: dto.version },
        data: { ...data, dayId: targetDayId, position, version: { increment: 1 }, updatedById: userId },
      });
      if (res.count !== 1) this.assertVersion(await this.findActivity(tx, tripId, activityId), dto.version);

      const updated = await this.findActivity(tx, tripId, activityId);
      return { activity: toActivityDto(updated), warnings: await this.warningsFor(tx, targetDayId, [updated.id]) };
    });
  }

  async deleteActivity(userId: string, tripId: string, activityId: string, version?: number): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.access.require(userId, tripId, 'itinerary:write', tx);
      const current = await this.findActivity(tx, tripId, activityId);
      if (version !== undefined) this.assertVersion(current, version);
      const res = await tx.activity.deleteMany({
        where: { id: activityId, ...(version !== undefined ? { version } : {}) },
      });
      if (res.count !== 1 && version !== undefined) {
        this.assertVersion(await this.findActivity(tx, tripId, activityId), version);
      }
    });
  }

  /**
   * Reordena o desempate entre atividades no mesmo horário. A lista precisa
   * conter todas as atividades do dia e respeitar a ordem por horário.
   */
  async reorder(userId: string, tripId: string, dayId: string, dto: ReorderActivitiesDto): Promise<DayDto> {
    return this.prisma.$transaction(async (tx) => {
      const { trip } = await this.access.require(userId, tripId, 'itinerary:write', tx);
      await this.findDay(tx, tripId, dayId);
      await this.prisma.lockRows(tx, 'TripDay', [dayId]);
      const activities = await tx.activity.findMany({ where: { dayId } });
      const byId = new Map(activities.map((a) => [a.id, a]));

      const ids = dto.items.map((i) => i.id);
      if (new Set(ids).size !== ids.length || ids.length !== activities.length || ids.some((id) => !byId.has(id))) {
        throw AppError.unprocessable(
          ErrorCode.INVALID_REORDER,
          'Envie todas as atividades do dia, sem repetições, na nova ordem.',
          { expectedIds: activities.map((a) => a.id) },
        );
      }
      for (const item of dto.items) this.assertVersion(byId.get(item.id)!, item.version);

      for (let i = 1; i < ids.length; i++) {
        if (byId.get(ids[i])!.startMinutes < byId.get(ids[i - 1])!.startMinutes) {
          throw AppError.unprocessable(
            ErrorCode.INVALID_REORDER,
            'A ordem precisa respeitar os horários. Para mudar a posição entre horários diferentes, altere o horário.',
            { activityId: ids[i] },
          );
        }
      }

      for (const [index, id] of ids.entries()) {
        const a = byId.get(id)!;
        if (a.position === index) continue;
        await tx.activity.update({
          where: { id },
          data: { position: index, version: { increment: 1 }, updatedById: userId },
        });
      }
      return this.dayDto(tx, trip, dayId);
    });
  }

  // ─────────────────── Sincronização de dias (alteração de datas) ───────────────────

  /**
   * Ajusta os dias da viagem ao novo intervalo: preserva os que continuam,
   * cria os que faltam e remove os que saíram. Dias removidos com atividades
   * exigem confirmação explícita (lista de datas em `confirmedDates`).
   */
  async syncDays(tx: Tx, tripId: string, start: string, end: string, confirmedDates: string[] = []): Promise<void> {
    const wanted = new Set(datesInRange(start, end));
    const existing = await tx.tripDay.findMany({
      where: { tripId },
      select: { id: true, date: true, _count: { select: { activities: true } } },
    });
    const outOfRange = existing.filter((d) => !wanted.has(toLocalDate(d.date)));
    if (outOfRange.length) await this.prisma.lockRows(tx, 'TripDay', outOfRange.map((d) => d.id));

    // Recontagem após o bloqueio: atividades podem ter sido criadas enquanto isso.
    const counts = await tx.activity.groupBy({
      by: ['dayId'],
      where: { dayId: { in: outOfRange.map((d) => d.id) } },
      _count: { _all: true },
    });
    const affected: AffectedDay[] = outOfRange
      .map((d) => ({
        dayId: d.id,
        date: toLocalDate(d.date),
        activityCount: counts.find((c) => c.dayId === d.id)?._count._all ?? 0,
      }))
      .filter((d) => d.activityCount > 0);

    const confirmed = new Set(confirmedDates);
    const unconfirmed = affected.filter((d) => !confirmed.has(d.date));
    if (unconfirmed.length) {
      throw AppError.conflict(
        ErrorCode.TRIP_DATE_CHANGE_CONFLICT,
        'Há atividades em dias que ficarão fora do novo período. Confirme a exclusão desses dias ou ajuste as datas.',
        { affectedDays: affected, confirmWith: 'confirmRemoveDates' },
      );
    }

    if (outOfRange.length) await tx.tripDay.deleteMany({ where: { id: { in: outOfRange.map((d) => d.id) } } });
    const have = new Set(existing.map((d) => toLocalDate(d.date)));
    const missing = [...wanted].filter((d) => !have.has(d));
    if (missing.length) {
      await tx.tripDay.createMany({
        data: missing.map((date) => ({ tripId, date: fromLocalDate(date) })),
        skipDuplicates: true,
      });
    }
  }

  // ───────────────────────────── Auxiliares ─────────────────────────────

  /**
   * Limite diário do plano. Precisa ser chamado com os dias já bloqueados
   * (FOR UPDATE) na mesma transação, para que requisições concorrentes não
   * ultrapassem o limite. Dias que já estão acima do limite (ex.: após reembolso)
   * continuam editáveis, mas não aceitam novas atividades.
   */
  private async assertCapacity(tx: Tx, trip: Trip, additions: { dayId: string; adding: number }[]): Promise<void> {
    const max = PLAN_FEATURES[trip.plan].maxActivitiesPerDay;
    if (max === null) return;
    const counts = await tx.activity.groupBy({
      by: ['dayId'],
      where: { dayId: { in: additions.map((a) => a.dayId) } },
      _count: { _all: true },
    });
    for (const { dayId, adding } of additions) {
      const current = counts.find((c) => c.dayId === dayId)?._count._all ?? 0;
      if (current + adding > max) {
        throw AppError.forbidden(
          ErrorCode.DAILY_ACTIVITY_LIMIT_REACHED,
          `O plano gratuito permite até ${max} atividades por dia.`,
          {
            dayId,
            limit: max,
            currentCount: current,
            attempted: adding,
            requiredPlans: Object.entries(PLAN_FEATURES)
              .filter(([, f]) => f.maxActivitiesPerDay === null)
              .map(([plan]) => plan),
            availableUpgrades: availableUpgrades(trip.plan),
          },
        );
      }
    }
  }

  private async nextPosition(tx: Tx, dayId: string, startMinutes: number): Promise<number> {
    const agg = await tx.activity.aggregate({ where: { dayId, startMinutes }, _max: { position: true } });
    return (agg._max.position ?? -1) + 1;
  }

  private assertVersion(current: Activity, expected: number): void {
    if (current.version !== expected) {
      throw AppError.conflict(
        ErrorCode.VERSION_CONFLICT,
        'Esta atividade foi alterada por outra pessoa. Recarregue e tente novamente.',
        { currentVersion: current.version, current: toActivityDto(current) },
      );
    }
  }

  private async warningsFor(tx: Tx, dayId: string, activityIds: string[]) {
    const activities = await tx.activity.findMany({ where: { dayId } });
    const ids = new Set(activityIds);
    return computeOverlaps(activities).filter((w) => ids.has(w.activityId) || ids.has(w.overlapsWithActivityId));
  }

  private async dayDto(db: Tx | PrismaService, trip: Pick<Trip, 'plan'>, dayId: string): Promise<DayDto> {
    const day = await db.tripDay.findUniqueOrThrow({ where: { id: dayId }, include: { activities: true } });
    return toDayDto(day, PLAN_FEATURES[trip.plan].maxActivitiesPerDay);
  }

  private async findDay(db: Tx | PrismaService, tripId: string, dayId: string) {
    const day = await db.tripDay.findFirst({ where: { id: dayId, tripId } });
    if (!day) throw AppError.notFound(ErrorCode.DAY_NOT_FOUND, 'Dia não encontrado nesta viagem.');
    return day;
  }

  private async findActivity(db: Tx | PrismaService, tripId: string, activityId: string) {
    const activity = await db.activity.findFirst({ where: { id: activityId, tripId } });
    if (!activity) throw AppError.notFound(ErrorCode.ACTIVITY_NOT_FOUND, 'Atividade não encontrada.');
    return activity;
  }

  private toData(dto: ActivityInputDto) {
    return {
      title: dto.title,
      startMinutes: timeToMinutes(dto.time),
      category: dto.category ?? ActivityCategory.outros,
      location: dto.location || null,
      durationMinutes: dto.durationMinutes ?? null,
      notes: dto.notes || null,
      ...resolvePlace(dto, null, false),
    };
  }

  /** Campos ausentes ficam como estão; `null` limpa campos opcionais. Ver `resolvePlace` para o lugar. */
  private toPartialData(
    dto: Partial<ActivityInputDto>,
    current: Activity,
  ): Prisma.ActivityUpdateManyMutationInput & { startMinutes?: number } {
    const locationChanged = dto.location !== undefined && !samePlaceText(dto.location, current.location);
    const place = resolvePlace(dto, current, locationChanged);
    const data: Prisma.ActivityUpdateManyMutationInput & { startMinutes?: number } = { ...place };
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.time !== undefined) data.startMinutes = timeToMinutes(dto.time);
    if (dto.category !== undefined) data.category = dto.category ?? ActivityCategory.outros;
    if (dto.location !== undefined) data.location = dto.location || null;
    if (dto.durationMinutes !== undefined) data.durationMinutes = dto.durationMinutes;
    if (dto.notes !== undefined) data.notes = dto.notes || null;
    return data;
  }

  /** Usado pela IA para validar propostas contra o roteiro atual. */
  async snapshot(tripId: string) {
    const days = await this.prisma.tripDay.findMany({
      where: { tripId },
      include: { activities: true },
      orderBy: { date: 'asc' },
    });
    return days.map((d) => ({ ...d, activities: sortActivities(d.activities) }));
  }
}
