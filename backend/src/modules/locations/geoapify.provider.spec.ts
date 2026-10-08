import type { AppConfig } from '../../config/app-config.service';
import { GeoapifyProvider, toSuggestion } from './geoapify.provider';
import { GeocodingProviderError, type GeocodingQuery } from './geocoding-provider';

const config = (key: string | null = 'chave-secreta') =>
  ({
    get: (k: string) => ({ GEOAPIFY_API_KEY: key ?? undefined, GEOCODING_TIMEOUT_MS: 1000 })[k],
  }) as unknown as AppConfig;

const query: GeocodingQuery = { text: 'Marco Zero', kind: 'place', limit: 5, lang: 'pt', near: null };

/** Resposta no formato `format=json` da Geoapify (campos usados). */
const marcoZero = {
  place_id: '51abc',
  lat: -8.0631,
  lon: -34.8711,
  name: 'Marco Zero',
  formatted: 'Marco Zero, Praça Rio Branco, Recife - PE, Brasil',
  address_line1: 'Marco Zero',
  address_line2: 'Praça Rio Branco, Recife - PE, Brasil',
  city: 'Recife',
  state: 'Pernambuco',
  country: 'Brasil',
  country_code: 'br',
  result_type: 'amenity',
};

function fakeFetch(response: { ok?: boolean; status?: number; body?: unknown } | Error) {
  const calls: string[] = [];
  const fn = jest.fn(async (url: string) => {
    calls.push(url);
    if (response instanceof Error) throw response;
    return { ok: response.ok ?? true, status: response.status ?? 200, json: async () => response.body };
  });
  return { fn, calls };
}

describe('GeoapifyProvider', () => {
  it('monta a consulta com idioma, limite e viés de proximidade (não filtro)', async () => {
    const { fn, calls } = fakeFetch({ body: { results: [marcoZero] } });
    const provider = new GeoapifyProvider(config(), fn);
    const results = await provider.search({ ...query, near: { latitude: -8.05, longitude: -34.88 } });

    const url = new URL(calls[0]);
    expect(url.origin + url.pathname).toBe('https://api.geoapify.com/v1/geocode/autocomplete');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      text: 'Marco Zero',
      format: 'json',
      lang: 'pt',
      limit: '5',
      bias: 'proximity:-34.88,-8.05',
      apiKey: 'chave-secreta',
    });
    expect(url.searchParams.has('filter')).toBe(false);
    expect(results).toEqual([
      expect.objectContaining({
        provider: 'geoapify',
        placeId: '51abc',
        name: 'Marco Zero',
        secondary: 'Praça Rio Branco, Recife - PE, Brasil',
        city: 'Recife',
        countryCode: 'BR',
        latitude: -8.0631,
        longitude: -34.8711,
      }),
    ]);
  });

  it('sem chave, não está configurado', () => {
    expect(new GeoapifyProvider(config(null)).isConfigured).toBe(false);
    expect(new GeoapifyProvider(config()).isConfigured).toBe(true);
  });

  it.each([
    [429, 'rate_limited'],
    [401, 'unauthorized'],
    [500, 'provider'],
  ])('HTTP %i vira erro do tipo %s', async (status, kind) => {
    const provider = new GeoapifyProvider(config(), fakeFetch({ ok: false, status }).fn);
    await expect(provider.search(query)).rejects.toMatchObject({ kind, httpStatus: status });
  });

  it('timeout e falha de rede viram erros do provedor', async () => {
    const timeout = Object.assign(new Error('t'), { name: 'TimeoutError' });
    await expect(new GeoapifyProvider(config(), fakeFetch(timeout).fn).search(query)).rejects.toMatchObject({ kind: 'timeout' });
    await expect(new GeoapifyProvider(config(), fakeFetch(new TypeError('fetch failed')).fn).search(query)).rejects.toBeInstanceOf(
      GeocodingProviderError,
    );
  });

  it('resposta fora do formato esperado é erro do provedor', async () => {
    const provider = new GeoapifyProvider(config(), fakeFetch({ body: { features: [] } }).fn);
    await expect(provider.search(query)).rejects.toMatchObject({ kind: 'provider' });
  });
});

describe('toSuggestion', () => {
  it('descarta resultados sem identificador ou coordenadas válidas', () => {
    expect(toSuggestion({ ...marcoZero, place_id: undefined })).toBeNull();
    expect(toSuggestion({ ...marcoZero, lat: undefined })).toBeNull();
    expect(toSuggestion({ ...marcoZero, lat: 95 })).toBeNull();
  });

  it('usa a primeira linha do endereço quando não há nome', () => {
    const s = toSuggestion({ ...marcoZero, name: undefined, address_line1: 'Rua da Aurora, 100', address_line2: 'Recife - PE' });
    expect(s).toMatchObject({ name: 'Rua da Aurora, 100', secondary: 'Recife - PE' });
  });
});
