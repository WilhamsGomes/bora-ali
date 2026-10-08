import { AppError, ErrorCode } from '../../common/errors/app-error';

/** Provedores cujos identificadores de lugar aceitamos guardar. */
export const PLACE_PROVIDERS = ['geoapify'] as const;
export type PlaceProvider = (typeof PLACE_PROVIDERS)[number];

/** Lugar associado a uma atividade (colunas de Activity). Sem coordenadas = só texto. */
export interface PlaceFields {
  formattedAddress: string | null;
  latitude: number | null;
  longitude: number | null;
  placeId: string | null;
  placeProvider: string | null;
}

export const EMPTY_PLACE: PlaceFields = {
  formattedAddress: null,
  latitude: null,
  longitude: null,
  placeId: null,
  placeProvider: null,
};

const PLACE_KEYS = Object.keys(EMPTY_PLACE) as (keyof PlaceFields)[];

const invalid = (field: string, message: string) =>
  AppError.badRequest(ErrorCode.VALIDATION_ERROR, message, { fields: [{ field, messages: [message] }] });

/**
 * Regras de consistência do lugar (também garantidas por CHECK no banco):
 * coordenadas só em par; identificador externo só com provedor e com coordenadas.
 */
export function assertPlace(p: PlaceFields): void {
  if ((p.latitude == null) !== (p.longitude == null)) {
    throw invalid('latitude', 'Informe latitude e longitude juntas.');
  }
  if ((p.placeId == null) !== (p.placeProvider == null)) {
    throw invalid('placeId', 'Informe o identificador do lugar junto com o provedor.');
  }
  if (p.placeId != null && p.latitude == null) {
    throw invalid('placeId', 'Um lugar identificado precisa de coordenadas.');
  }
}

/**
 * Calcula o lugar resultante de uma criação/edição.
 * - O lugar é tratado como unidade: se a requisição informa qualquer campo do lugar,
 *   os campos ausentes ficam nulos (evita misturar o identificador antigo com coordenadas novas).
 * - Se nada do lugar é informado, mantém o atual — exceto quando o texto do local mudou:
 *   aí as coordenadas antigas deixam de valer e são limpas.
 * - Sem coordenadas, o endereço formatado também é descartado.
 */
export function resolvePlace(
  input: Partial<Record<keyof PlaceFields, string | number | null | undefined>>,
  current: PlaceFields | null,
  locationChanged: boolean,
): PlaceFields {
  const touched = PLACE_KEYS.some((k) => input[k] !== undefined);
  let next: PlaceFields;
  if (touched) {
    // O par é sempre enviado completo (inclusive para limpar: latitude e longitude null).
    if ((input.latitude === undefined) !== (input.longitude === undefined)) {
      throw invalid('latitude', 'Informe latitude e longitude juntas.');
    }
    const str = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
    const num = (v: unknown) => (typeof v === 'number' ? v : null);
    next = {
      formattedAddress: str(input.formattedAddress),
      latitude: num(input.latitude),
      longitude: num(input.longitude),
      placeId: str(input.placeId),
      placeProvider: str(input.placeProvider),
    };
  } else {
    next = current && !locationChanged ? { ...current } : { ...EMPTY_PLACE };
  }
  assertPlace(next);
  if (next.latitude == null) next.formattedAddress = null;
  return next;
}

export function samePlaceText(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? '').trim() === (b ?? '').trim();
}
