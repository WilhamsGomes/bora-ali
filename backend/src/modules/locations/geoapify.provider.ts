import { Logger } from '@nestjs/common';
import { AppConfig } from '../../config/app-config.service';
import {
  GeocodingProvider,
  GeocodingProviderError,
  GeocodingQuery,
  PlaceSuggestion,
} from './geocoding-provider';

const BASE_URL = 'https://api.geoapify.com/v1/geocode/autocomplete';

/** Campos usados da resposta `format=json` do Address Autocomplete API. */
interface GeoapifyResult {
  place_id?: string;
  lat?: number;
  lon?: number;
  name?: string;
  formatted?: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state?: string;
  country?: string;
  country_code?: string;
  result_type?: string;
}

type FetchLike = (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

/**
 * Geoapify Address Autocomplete (https://apidocs.geoapify.com/docs/geocoding/address-autocomplete/).
 * - A chave (GEOAPIFY_API_KEY) só existe no backend e nunca é registrada em log.
 * - Cada requisição consome 1 crédito; o plano gratuito tem limite diário e por segundo.
 * - Termos: atribuição a OpenStreetMap sempre; "Powered by Geoapify" no plano gratuito.
 */
export class GeoapifyProvider extends GeocodingProvider {
  readonly name = 'geoapify';
  readonly attribution = '© OpenStreetMap contributors · Powered by Geoapify';
  private readonly logger = new Logger('Geocoding');

  constructor(
    private readonly config: AppConfig,
    private readonly fetchFn: FetchLike = (url, init) => fetch(url, init),
  ) {
    super();
  }

  get isConfigured(): boolean {
    return !!this.config.get('GEOAPIFY_API_KEY');
  }

  async search(query: GeocodingQuery): Promise<PlaceSuggestion[]> {
    const params = new URLSearchParams({
      text: query.text,
      format: 'json',
      lang: query.lang,
      limit: String(query.limit),
    });
    // Destinos não são filtrados por tipo: podem ser cidades, ilhas, regiões ou países.
    // Viés, não filtro: passeios em cidades vizinhas continuam aparecendo.
    if (query.near) params.set('bias', `proximity:${query.near.longitude},${query.near.latitude}`);
    params.set('apiKey', this.config.get('GEOAPIFY_API_KEY') ?? '');

    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await this.fetchFn(`${BASE_URL}?${params}`, {
        signal: AbortSignal.timeout(this.config.get('GEOCODING_TIMEOUT_MS')),
        headers: { Accept: 'application/json' },
      });
    } catch (e) {
      const timeout = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
      this.logger.warn(`Falha ao consultar a Geoapify: ${timeout ? 'tempo esgotado' : 'erro de rede'}`);
      throw new GeocodingProviderError(timeout ? 'timeout' : 'provider', 'Falha de rede ao consultar o provedor.');
    }

    if (!res.ok) {
      this.logger.warn(`Geoapify respondeu HTTP ${res.status}`);
      const kind = res.status === 429 ? 'rate_limited' : res.status === 401 || res.status === 403 ? 'unauthorized' : 'provider';
      throw new GeocodingProviderError(kind, `Provedor respondeu HTTP ${res.status}.`, res.status);
    }

    const body = (await res.json().catch(() => null)) as { results?: GeoapifyResult[] } | null;
    if (!body || !Array.isArray(body.results)) {
      throw new GeocodingProviderError('provider', 'Resposta inesperada do provedor.');
    }
    return body.results.map(toSuggestion).filter((s): s is PlaceSuggestion => s !== null);
  }
}

export function toSuggestion(r: GeoapifyResult): PlaceSuggestion | null {
  if (!r.place_id || typeof r.lat !== 'number' || typeof r.lon !== 'number') return null;
  if (Math.abs(r.lat) > 90 || Math.abs(r.lon) > 180) return null;
  const formatted = r.formatted?.trim() || [r.address_line1, r.address_line2].filter(Boolean).join(', ');
  const name = r.name?.trim() || r.address_line1?.trim() || formatted;
  if (!name || !formatted) return null;
  const secondary = name === r.address_line1?.trim() ? r.address_line2?.trim() : formatted;
  return {
    provider: 'geoapify',
    placeId: r.place_id,
    name: name.slice(0, 300),
    formattedAddress: formatted.slice(0, 500),
    secondary: secondary && secondary !== name ? secondary.slice(0, 500) : null,
    city: r.city ?? null,
    state: r.state ?? null,
    country: r.country ?? null,
    countryCode: r.country_code?.toUpperCase() ?? null,
    latitude: r.lat,
    longitude: r.lon,
    resultType: r.result_type ?? null,
  };
}

/** Provedor desativado (GEOCODING_PROVIDER=none): a busca responde indisponível. */
export class DisabledGeocodingProvider extends GeocodingProvider {
  readonly name = 'none';
  readonly isConfigured = false;
  readonly attribution = '';
  search(): Promise<PlaceSuggestion[]> {
    throw new GeocodingProviderError('provider', 'Busca de locais desativada.');
  }
}
