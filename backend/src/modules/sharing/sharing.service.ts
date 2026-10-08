import { Injectable } from '@nestjs/common';
import { Activity, ActivityCategory, ShareLink, Trip } from '@prisma/client';
import { AppError, ErrorCode } from '../../common/errors/app-error';
import { toLocalDate } from '../../common/utils/local-date';
import { minutesToTime } from '../../common/utils/local-time';
import { generateToken } from '../../common/utils/secure-token';
import { AppConfig } from '../../config/app-config.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PLAN_FEATURES } from '../entitlements/plan-policy';
import { TripAccessService } from '../entitlements/trip-access.service';
import { sortActivities } from '../itinerary/itinerary.mapper';
import type { PublicTripDto, ShareLinkDto, UpdateShareLinkDto } from './dto/sharing.dto';

/**
 * Endereço e coordenadas exibidos no link público. Atividades de hospedagem ficam sem
 * ponto no mapa: a localização exata de onde o grupo dorme não é exposta publicamente.
 * Identificadores do provedor também não fazem parte do contrato público.
 */
function publicPlace(a: Pick<Activity, 'category' | 'formattedAddress' | 'latitude' | 'longitude'>) {
  if (a.category === ActivityCategory.hospedagem || a.latitude == null || a.longitude == null) {
    return { formattedAddress: null, latitude: null, longitude: null };
  }
  return { formattedAddress: a.formattedAddress, latitude: a.latitude, longitude: a.longitude };
}

@Injectable()
export class SharingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TripAccessService,
    private readonly config: AppConfig,
  ) {}

  async get(userId: string, tripId: string): Promise<ShareLinkDto> {
    const { trip } = await this.access.require(userId, tripId, 'trip:manage');
    const link = await this.prisma.shareLink.findUnique({ where: { tripId } });
    return this.toDto(trip, link);
  }

  async update(userId: string, tripId: string, dto: UpdateShareLinkDto): Promise<ShareLinkDto> {
    // Desativar é sempre permitido ao proprietário; ativar/configurar exige plano com compartilhamento.
    const { trip } = await this.access.require(userId, tripId, dto.enabled ? 'share:manage' : 'trip:manage');
    const link = await this.prisma.shareLink.upsert({
      where: { tripId },
      create: { tripId, token: generateToken(), enabled: dto.enabled, showNotes: dto.showNotes ?? false },
      update: { enabled: dto.enabled, ...(dto.showNotes !== undefined ? { showNotes: dto.showNotes } : {}) },
    });
    return this.toDto(trip, link);
  }

  /** Gera um novo token; o link anterior deixa de funcionar imediatamente. */
  async rotate(userId: string, tripId: string): Promise<ShareLinkDto> {
    const { trip } = await this.access.require(userId, tripId, 'share:manage');
    const link = await this.prisma.shareLink.upsert({
      where: { tripId },
      create: { tripId, token: generateToken(), enabled: true },
      update: { token: generateToken() },
    });
    return this.toDto(trip, link);
  }

  /** Visualização pública somente leitura: sem e-mails, participantes, IDs internos ou cobrança. */
  async getPublic(token: string): Promise<PublicTripDto> {
    const notFound = () => AppError.notFound(ErrorCode.SHARE_LINK_NOT_FOUND, 'Link não encontrado ou desativado.');
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) throw notFound();

    const link = await this.prisma.shareLink.findUnique({
      where: { token },
      include: {
        trip: { include: { days: { include: { activities: true }, orderBy: { date: 'asc' } } } },
      },
    });
    if (!link || !link.enabled || !PLAN_FEATURES[link.trip.plan].publicSharing) throw notFound();

    const { trip } = link;
    return {
      name: trip.name,
      destination: trip.destination,
      startDate: toLocalDate(trip.startDate),
      endDate: toLocalDate(trip.endDate),
      timeZone: trip.timeZone,
      coverUrl: trip.coverUrl,
      // Centro do destino (cidade), para centralizar o mapa. A hospedagem (`stay`) nunca é exposta.
      destinationCenter:
        trip.destinationLatitude != null && trip.destinationLongitude != null
          ? { latitude: trip.destinationLatitude, longitude: trip.destinationLongitude }
          : null,
      days: trip.days.map((day) => ({
        date: toLocalDate(day.date),
        title: day.title,
        activities: sortActivities(day.activities).map((a) => ({
          title: a.title,
          time: minutesToTime(a.startMinutes),
          category: a.category,
          location: a.location,
          durationMinutes: a.durationMinutes,
          ...publicPlace(a),
          ...(link.showNotes ? { notes: a.notes } : {}),
        })),
      })),
    };
  }

  private toDto(trip: Trip, link: ShareLink | null): ShareLinkDto {
    if (!link) return { enabled: false, active: false, showNotes: false, url: null, token: null };
    return {
      enabled: link.enabled,
      active: link.enabled && PLAN_FEATURES[trip.plan].publicSharing,
      showNotes: link.showNotes,
      url: `${this.config.get('FRONTEND_URL')}/r/${link.token}`,
      token: link.token,
    };
  }
}
