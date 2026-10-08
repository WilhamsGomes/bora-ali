import { addDays, datesInRange, daySpan, fromLocalDate, isValidLocalDate, isValidTimeZone, toLocalDate } from './local-date';
import { minutesToTime, timeToMinutes } from './local-time';

describe('datas e horários locais', () => {
  it('converte datas sem depender do fuso do servidor', () => {
    expect(toLocalDate(fromLocalDate('2026-12-31'))).toBe('2026-12-31');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(datesInRange('2026-03-07', '2026-03-09')).toEqual(['2026-03-07', '2026-03-08', '2026-03-09']);
    expect(daySpan('2026-01-01', '2026-01-01')).toBe(1);
  });

  it('rejeita datas inválidas', () => {
    expect(isValidLocalDate('2026-02-30')).toBe(false);
    expect(isValidLocalDate('2026-2-3')).toBe(false);
    expect(isValidLocalDate('2026-12-24T00:00:00Z')).toBe(false);
  });

  it('valida fusos IANA', () => {
    expect(isValidTimeZone('America/Sao_Paulo')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Lisboa/Centro')).toBe(false);
    expect(isValidTimeZone('-03:00')).toBe(false);
  });

  it('converte HH:MM em minutos e de volta', () => {
    expect(timeToMinutes('00:00')).toBe(0);
    expect(timeToMinutes('23:59')).toBe(1439);
    expect(minutesToTime(570)).toBe('09:30');
    expect(() => timeToMinutes('24:00')).toThrow();
  });
});
