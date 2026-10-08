/** Lugar sugerido por um provedor de geocodificação, já normalizado. */
export interface PlaceSuggestion {
  provider: string;
  placeId: string;
  /** Nome do lugar (ex.: "Marco Zero") ou a primeira linha do endereço */
  name: string;
  /** Endereço completo, como o provedor formata */
  formattedAddress: string;
  /** Complemento para exibição (normalmente rua/bairro/cidade) */
  secondary: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  countryCode: string | null;
  latitude: number;
  longitude: number;
  /** Tipo do resultado no provedor (amenity, street, city...) */
  resultType: string | null;
}

export interface GeocodingQuery {
  text: string;
  /** place = qualquer lugar; destination = cidades, regiões e localidades */
  kind: 'place' | 'destination';
  limit: number;
  lang: string;
  /** Favorece resultados perto deste ponto, sem excluir os demais */
  near?: { latitude: number; longitude: number } | null;
}

export type GeocodingErrorKind = 'timeout' | 'rate_limited' | 'unauthorized' | 'provider';

export class GeocodingProviderError extends Error {
  constructor(
    readonly kind: GeocodingErrorKind,
    message: string,
    readonly httpStatus: number | null = null,
  ) {
    super(message);
    this.name = 'GeocodingProviderError';
  }
}

/** Porta para o provedor de busca de lugares. Implementação de produção: Geoapify. */
export abstract class GeocodingProvider {
  abstract readonly name: string;
  /** false quando falta configuração (ex.: chave); a busca responde 503 sem chamar o provedor. */
  abstract readonly isConfigured: boolean;
  /** Texto de atribuição exigido pelos termos do provedor/dados. */
  abstract readonly attribution: string;
  abstract search(query: GeocodingQuery): Promise<PlaceSuggestion[]>;
}
