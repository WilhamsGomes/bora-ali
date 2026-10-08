import { AppError } from '../../common/errors/app-error';
import { EMPTY_PLACE, PlaceFields, resolvePlace } from './place';

const current: PlaceFields = {
  formattedAddress: 'Marco Zero, Recife',
  latitude: -8.06,
  longitude: -34.87,
  placeId: 'p1',
  placeProvider: 'geoapify',
};

describe('resolvePlace', () => {
  it('mantém o lugar atual quando nada do lugar é enviado e o texto não muda', () => {
    expect(resolvePlace({}, current, false)).toEqual(current);
  });

  it('limpa o lugar quando o texto do local muda sem novo lugar', () => {
    expect(resolvePlace({}, current, true)).toEqual(EMPTY_PLACE);
  });

  it('trata o lugar como unidade: campos ausentes ficam nulos', () => {
    expect(resolvePlace({ latitude: 1, longitude: 2 }, current, false)).toEqual({ ...EMPTY_PLACE, latitude: 1, longitude: 2 });
  });

  it('descarta o endereço formatado sem coordenadas', () => {
    expect(resolvePlace({ formattedAddress: 'Rua X' }, null, false)).toEqual(EMPTY_PLACE);
  });

  it.each([
    [{ latitude: 1 }],
    [{ longitude: 1 }],
    [{ latitude: null }],
    [{ latitude: 1, longitude: 2, placeId: 'x' }],
    [{ latitude: 1, longitude: 2, placeProvider: 'geoapify' }],
    [{ placeId: 'x', placeProvider: 'geoapify' }],
  ])('recusa combinação inconsistente %j', (input) => {
    expect(() => resolvePlace(input, null, false)).toThrow(AppError);
  });

  it('aceita coordenadas zero (equador/meridiano)', () => {
    expect(resolvePlace({ latitude: 0, longitude: 0 }, null, false)).toMatchObject({ latitude: 0, longitude: 0 });
  });
});
