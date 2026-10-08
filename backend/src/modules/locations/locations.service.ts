import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppError, ErrorCode } from '../../common/errors/app-error';
import { AppConfig } from '../../config/app-config.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TripAccessService } from '../entitlements/trip-access.service';
import type { PlaceSearchQueryDto, PlaceSearchResultDto } from './dto/location.dto';
import { GeocodingProvider, GeocodingProviderError, GeocodingQuery, PlaceSuggestion } from './geocoding-provider';

const DEFAULT_LIMIT = 6;
/** Sempre pede o máximo ao provedor e recorta na resposta: o limite não divide o cache. */
export const PROVIDER_LIMIT = 8;
/** Região do viés arredondada a 0,1° (~11 km): viagens para a mesma cidade compartilham o cache. */
const BIAS_DECIMALS = 1;
const WINDOW_MS = 60_000;
const DAY_MS = 86_400_000;

interface CacheEntry {
  expiresAt: number;
  results: PlaceSuggestion[];
}

type CacheSource = 'memory' | 'database' | 'provider';

/** Texto da busca para comparação: sem acentos, minúsculo e com espaços simples. */
export function normalizeQuery(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ')
    .trim();
}

export function searchCacheKey(provider: string, q: Pick<GeocodingQuery, 'kind' | 'lang' | 'near' | 'text'>): string {
  const near = q.near ? `${q.near.latitude.toFixed(BIAS_DECIMALS)},${q.near.longitude.toFixed(BIAS_DECIMALS)}` : '-';
  return [provider, q.kind, q.lang, near, normalizeQuery(q.text)].join('|');
}

/**
 * Busca de lugares para atividades e para o destino da viagem.
 * - Exige acesso de escrita à viagem (a busca serve para editar).
 * - Orienta (sem restringir) os resultados pela região do destino confirmado.
 * - Cache em duas camadas, ambas com a resposta exata do provedor (nunca uma busca aproximada
 *   nos lugares salvos, que poderia esconder a opção certa):
 *   1. memória do processo (rápida, some ao reiniciar);
 *   2. tabela PlaceSearchCache (compartilhada entre instâncias e persistente).
 *   Os termos da Geoapify permitem armazenar resultados mantendo a atribuição.
 * - Consultas simultâneas iguais compartilham uma única chamada ao provedor.
 * - Limite por usuário só para chamadas ao provedor (acertos de cache não contam).
 */
@Injectable()
export class LocationsService {
  private readonly logger = new Logger('PlaceSearch');
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<PlaceSuggestion[]>>();
  private readonly userCalls = new Map<string, number[]>();
  /** Contadores desde o início do processo (para acompanhar a economia de créditos). */
  readonly stats: Record<CacheSource, number> = { memory: 0, database: 0, provider: 0 };

  constructor(
    private readonly provider: GeocodingProvider,
    private readonly access: TripAccessService,
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  async search(userId: string, tripId: string, dto: PlaceSearchQueryDto): Promise<PlaceSearchResultDto> {
    const kind = dto.kind ?? 'place';
    const { trip } = await this.access.require(userId, tripId, kind === 'destination' ? 'trip:manage' : 'itinerary:write');

    if (!this.provider.isConfigured) {
      throw AppError.unavailable(
        ErrorCode.LOCATION_SEARCH_UNAVAILABLE,
        'A busca de locais não está configurada neste servidor. Você pode salvar o local só como texto.',
      );
    }

    const near =
      kind === 'place' && trip.destinationLatitude != null && trip.destinationLongitude != null
        ? {
            // O provedor recebe o mesmo ponto arredondado da chave: o cache corresponde exatamente à consulta.
            latitude: Number(trip.destinationLatitude.toFixed(BIAS_DECIMALS)),
            longitude: Number(trip.destinationLongitude.toFixed(BIAS_DECIMALS)),
          }
        : null;
    const query: GeocodingQuery = {
      text: dto.q.replace(/\s+/g, ' ').trim(),
      kind,
      limit: PROVIDER_LIMIT,
      lang: 'pt',
      near,
    };
    const results = await this.cached(userId, query);
    return {
      results: results.slice(0, dto.limit ?? DEFAULT_LIMIT),
      attribution: this.provider.attribution,
      biasedToDestination: near !== null,
    };
  }

  private async cached(userId: string, query: GeocodingQuery): Promise<PlaceSuggestion[]> {
    const key = searchCacheKey(this.provider.name, query);
    const now = Date.now();

    const hit = this.cache.get(key);
    if (hit && hit.expiresAt > now) {
      // Reinsere para manter a ordem de uso recente (LRU simples sobre a ordem do Map).
      this.cache.delete(key);
      this.cache.set(key, hit);
      return this.served('memory', key, hit.results);
    }
    if (hit) this.cache.delete(key);

    const stored = await this.readDatabase(key, now);
    if (stored) {
      this.remember(key, stored, now);
      return this.served('database', key, stored);
    }

    const pending = this.inFlight.get(key);
    if (pending) return pending;

    this.consumeUserQuota(userId, now);
    const promise = this.callProvider(query)
      .then(async (results) => {
        this.remember(key, results, now);
        await this.writeDatabase(key, query, results, now);
        return this.served('provider', key, results);
      })
      .finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, promise);
    return promise;
  }

  private served(source: CacheSource, key: string, results: PlaceSuggestion[]) {
    this.stats[source]++;
    this.logger.debug(`${source} · ${results.length} resultado(s) · ${key}`);
    return results;
  }

  private async callProvider(query: GeocodingQuery): Promise<PlaceSuggestion[]> {
    try {
      const seen = new Set<string>();
      return (await this.provider.search(query))
        .filter((r) => !seen.has(r.placeId) && seen.add(r.placeId))
        .slice(0, query.limit);
    } catch (e) {
      if (!(e instanceof GeocodingProviderError)) throw e;
      const messages: Record<GeocodingProviderError['kind'], string> = {
        timeout: 'A busca de locais demorou demais para responder. Tente novamente.',
        rate_limited: 'A busca de locais está temporariamente sobrecarregada. Tente novamente em instantes.',
        unauthorized: 'A busca de locais está indisponível no momento (configuração do provedor).',
        provider: 'A busca de locais está indisponível no momento. Tente novamente.',
      };
      throw AppError.badGateway(ErrorCode.LOCATION_PROVIDER_ERROR, messages[e.kind], { reason: e.kind });
    }
  }

  // ───────── Camada 1: memória ─────────

  private remember(key: string, results: PlaceSuggestion[], now: number) {
    const ttl = this.config.get('GEOCODING_CACHE_TTL_SECONDS') * 1000;
    const max = this.config.get('GEOCODING_CACHE_MAX_ENTRIES');
    if (ttl <= 0 || max <= 0) return;
    this.cache.set(key, { expiresAt: now + ttl, results });
    while (this.cache.size > max) this.cache.delete(this.cache.keys().next().value!);
  }

  // ───────── Camada 2: banco ─────────

  /** Falhas do banco não impedem a busca: seguem para o provedor. */
  private async readDatabase(key: string, now: number): Promise<PlaceSuggestion[] | null> {
    if (this.config.get('GEOCODING_DB_CACHE_TTL_DAYS') <= 0) return null;
    try {
      const row = await this.prisma.placeSearchCache.findUnique({ where: { key } });
      if (!row || row.expiresAt.getTime() <= now || !Array.isArray(row.results)) return null;
      void this.prisma.placeSearchCache
        .update({ where: { key }, data: { hits: { increment: 1 }, lastHitAt: new Date(now) } })
        .catch(() => undefined);
      return row.results as unknown as PlaceSuggestion[];
    } catch (e) {
      this.logger.warn(`Cache de buscas indisponível (leitura): ${(e as Error).message}`);
      return null;
    }
  }

  /** Respostas vazias ficam só na memória: um lugar recém-mapeado não fica escondido por meses. */
  private async writeDatabase(key: string, query: GeocodingQuery, results: PlaceSuggestion[], now: number) {
    const days = this.config.get('GEOCODING_DB_CACHE_TTL_DAYS');
    if (days <= 0 || results.length === 0) return;
    const data = {
      provider: this.provider.name,
      kind: query.kind,
      query: normalizeQuery(query.text),
      results: results as unknown as Prisma.InputJsonValue,
      createdAt: new Date(now),
      expiresAt: new Date(now + days * DAY_MS),
    };
    try {
      await this.prisma.placeSearchCache.upsert({ where: { key }, create: { key, ...data }, update: data });
    } catch (e) {
      this.logger.warn(`Cache de buscas indisponível (escrita): ${(e as Error).message}`);
    }
  }

  /** Remove entradas vencidas (manutenção; leituras já ignoram o que venceu). */
  async purgeExpired(now = new Date()): Promise<number> {
    const { count } = await this.prisma.placeSearchCache.deleteMany({ where: { expiresAt: { lte: now } } });
    return count;
  }

  // ───────── Limite por usuário ─────────

  private consumeUserQuota(userId: string, now: number) {
    const limit = this.config.get('GEOCODING_USER_LIMIT_PER_MINUTE');
    const calls = (this.userCalls.get(userId) ?? []).filter((t) => now - t < WINDOW_MS);
    if (calls.length >= limit) {
      this.userCalls.set(userId, calls);
      throw AppError.tooManyRequests(ErrorCode.RATE_LIMITED, 'Muitas buscas seguidas. Aguarde alguns segundos.', {
        retryAfterSeconds: Math.ceil((WINDOW_MS - (now - calls[0])) / 1000),
      });
    }
    calls.push(now);
    this.userCalls.set(userId, calls);
    // Evita crescer indefinidamente com usuários inativos.
    if (this.userCalls.size > 10_000) {
      for (const [id, list] of this.userCalls) if (!list.some((t) => now - t < WINDOW_MS)) this.userCalls.delete(id);
    }
  }
}
