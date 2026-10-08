import type { Activity, TripDay } from '@prisma/client';
import { toLocalDate } from '../../common/utils/local-date';
import { minutesToTime } from '../../common/utils/local-time';
import type { ActivityDto, OverlapWarningDto } from './dto/activity.dto';
import type { DayDto } from './dto/day.dto';

export function toActivityDto(a: Activity): ActivityDto {
  return {
    id: a.id,
    tripId: a.tripId,
    dayId: a.dayId,
    title: a.title,
    time: minutesToTime(a.startMinutes),
    category: a.category,
    location: a.location,
    durationMinutes: a.durationMinutes,
    notes: a.notes,
    formattedAddress: a.formattedAddress,
    latitude: a.latitude,
    longitude: a.longitude,
    placeId: a.placeId,
    placeProvider: a.placeProvider,
    position: a.position,
    version: a.version,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

/** Ordenação canônica do roteiro: horário, depois posição (desempate), depois criação. */
export function sortActivities<T extends Pick<Activity, 'startMinutes' | 'position' | 'createdAt'>>(list: T[]): T[] {
  return [...list].sort(
    (a, b) =>
      a.startMinutes - b.startMinutes || a.position - b.position || a.createdAt.getTime() - b.createdAt.getTime(),
  );
}

type OverlapInput = Pick<Activity, 'id' | 'title' | 'startMinutes' | 'durationMinutes' | 'position' | 'createdAt'>;

/**
 * Avisos de sobreposição (informativos). Só há sobreposição quando a atividade
 * anterior tem duração definida e a seguinte começa antes do fim dela, ou quando
 * duas atividades começam no mesmo horário e alguma tem duração.
 */
export function computeOverlaps(list: OverlapInput[]): OverlapWarningDto[] {
  const sorted = sortActivities(list);
  const warnings: OverlapWarningDto[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    const aEnd = a.startMinutes + (a.durationMinutes ?? 0);
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j];
      const overlaps =
        (a.durationMinutes && b.startMinutes < aEnd) || (b.startMinutes === a.startMinutes && b.durationMinutes);
      if (!overlaps) continue;
      const range = a.durationMinutes
        ? `${minutesToTime(a.startMinutes)}–${minutesToTime(aEnd % 1440)}`
        : minutesToTime(a.startMinutes);
      warnings.push({
        code: 'TIME_OVERLAP',
        activityId: a.id,
        overlapsWithActivityId: b.id,
        message: `"${a.title}" (${range}) se sobrepõe a "${b.title}" (${minutesToTime(b.startMinutes)}).`,
      });
    }
  }
  return warnings;
}

export function toDayDto(day: TripDay & { activities: Activity[] }, maxPerDay: number | null): DayDto {
  const activities = sortActivities(day.activities);
  return {
    id: day.id,
    date: toLocalDate(day.date),
    title: day.title,
    activities: activities.map(toActivityDto),
    warnings: computeOverlaps(activities),
    canAddActivities: maxPerDay === null || activities.length < maxPerDay,
  };
}
