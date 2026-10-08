import { normalizeQuery, searchCacheKey } from './locations.service';

describe('chave do cache de buscas', () => {
  it('normaliza acentos, maiúsculas e espaços', () => {
    expect(normalizeQuery('  Paço   do FREVO ')).toBe('paco do frevo');
    expect(normalizeQuery('São João')).toBe('sao joao');
  });

  it('arredonda a região a 0,1° e separa tipo e idioma', () => {
    const base = { kind: 'place' as const, lang: 'pt', text: 'Marco Zero' };
    const a = searchCacheKey('geoapify', { ...base, near: { latitude: -8.0578, longitude: -34.8829 } });
    const b = searchCacheKey('geoapify', { ...base, near: { latitude: -8.0631, longitude: -34.8711 } });
    expect(a).toBe(b);
    expect(a).toBe('geoapify|place|pt|-8.1,-34.9|marco zero');
    expect(searchCacheKey('geoapify', { ...base, near: null })).toBe('geoapify|place|pt|-|marco zero');
    expect(searchCacheKey('geoapify', { ...base, kind: 'destination', near: null })).not.toBe(
      searchCacheKey('geoapify', { ...base, near: null }),
    );
  });
});
