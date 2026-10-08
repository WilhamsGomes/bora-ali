import { registerDecorator, ValidationOptions } from 'class-validator';
import { isValidLocalDate, isValidTimeZone } from './utils/local-date';
import { TIME_RE } from './utils/local-time';

function simple(name: string, test: (v: unknown) => boolean, message: string) {
  return (options?: ValidationOptions) => (object: object, propertyName: string) =>
    registerDecorator({
      name,
      target: object.constructor,
      propertyName,
      options: { message, ...options },
      validator: { validate: test },
    });
}

/** Data local no formato YYYY-MM-DD (sem fuso). */
export const IsLocalDate = simple(
  'isLocalDate',
  (v) => typeof v === 'string' && isValidLocalDate(v),
  '$property deve ser uma data válida no formato YYYY-MM-DD',
);

/** Horário local no formato HH:MM (24h). */
export const IsLocalTime = simple(
  'isLocalTime',
  (v) => typeof v === 'string' && TIME_RE.test(v),
  '$property deve ser um horário no formato HH:MM',
);

/** Identificador de fuso IANA, ex.: America/Sao_Paulo. */
export const IsIanaTimeZone = simple(
  'isIanaTimeZone',
  (v) => typeof v === 'string' && isValidTimeZone(v),
  '$property deve ser um fuso IANA válido (ex.: America/Sao_Paulo)',
);

export const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
