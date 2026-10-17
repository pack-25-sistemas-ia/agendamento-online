// Fuso horário da empresa: conversões locais, horário de verão (hora inexistente e hora repetida), datas e formatação.
import { describe, expect, it } from 'vitest';
import {
  addDays, dateRange, daysBetween, formatDateBR, formatDateLong, formatInstant, fromMinutes, instantToLocal, isDate, isTime, isValidTimeZone, localToInstant, offsetMinutesAt, toMinutes, weekStart, weekdayOf,
} from '@/lib/scheduling/time';

const SP = 'America/Sao_Paulo';
const NY = 'America/New_York';
const utc = (s: string): number => Date.parse(s);

describe('deslocamento e conversão', () => {
  it('São Paulo (sem horário de verão): UTC−3 o ano todo', () => {
    expect(offsetMinutesAt(utc('2026-01-15T12:00:00Z'), SP)).toBe(-180);
    expect(offsetMinutesAt(utc('2026-07-15T12:00:00Z'), SP)).toBe(-180);
    expect(localToInstant('2026-03-10', '10:00', SP)).toBe(utc('2026-03-10T13:00:00Z'));
    expect(localToInstant('2026-03-10', '00:00', SP)).toBe(utc('2026-03-10T03:00:00Z'));
  });
  it('Nova York: UTC−5 no inverno e UTC−4 no verão', () => {
    expect(offsetMinutesAt(utc('2027-01-15T12:00:00Z'), NY)).toBe(-300);
    expect(offsetMinutesAt(utc('2027-07-15T12:00:00Z'), NY)).toBe(-240);
    expect(localToInstant('2027-01-11', '09:00', NY)).toBe(utc('2027-01-11T14:00:00Z'));
    expect(localToInstant('2027-07-12', '09:00', NY)).toBe(utc('2027-07-12T13:00:00Z'));
  });
  it('SALTO (14/03/2027): 02:00–02:59 não existe e é deslocada para frente', () => {
    expect(localToInstant('2027-03-14', '01:59', NY)).toBe(utc('2027-03-14T06:59:00Z'));
    expect(localToInstant('2027-03-14', '02:00', NY)).toBe(utc('2027-03-14T07:00:00Z'));
    expect(localToInstant('2027-03-14', '02:30', NY)).toBe(utc('2027-03-14T07:30:00Z')); // = 03:30 local
    expect(localToInstant('2027-03-14', '03:00', NY)).toBe(utc('2027-03-14T07:00:00Z'));
    expect(instantToLocal(localToInstant('2027-03-14', '02:30', NY), NY).time).toBe('03:30');
  });
  it('VOLTA (07/11/2027): 01:00–01:59 acontece duas vezes e vale a ocorrência POSTERIOR', () => {
    expect(localToInstant('2027-11-07', '00:30', NY)).toBe(utc('2027-11-07T04:30:00Z'));
    expect(localToInstant('2027-11-07', '01:30', NY)).toBe(utc('2027-11-07T06:30:00Z')); // a de 05:30Z (EDT) é ignorada
    expect(localToInstant('2027-11-07', '02:30', NY)).toBe(utc('2027-11-07T07:30:00Z'));
  });
  it('«24:00» é a meia-noite do dia seguinte', () => {
    expect(localToInstant('2026-03-10', '24:00', SP)).toBe(localToInstant('2026-03-11', '00:00', SP));
  });
  it('entradas inválidas são recusadas', () => {
    expect(() => localToInstant('2026-02-30', '10:00', SP)).toThrow(RangeError);
    expect(() => localToInstant('2026-03-10', '25:00', SP)).toThrow(RangeError);
    expect(() => localToInstant('10/03/2026', '10:00', SP)).toThrow(RangeError);
    expect(isValidTimeZone(SP)).toBe(true);
    expect(isValidTimeZone('Marte/Olympus')).toBe(false);
  });
  it('instantToLocal é o inverso de localToInstant fora das horas ambíguas', () => {
    for (const [d, t, tz] of [['2026-03-10', '10:00', SP], ['2027-07-12', '23:59', NY], ['2027-01-11', '00:00', NY], ['2026-12-31', '23:30', SP]] as const) {
      const l = instantToLocal(localToInstant(d, t, tz), tz);
      expect([l.date, l.time]).toEqual([d, t]);
    }
    expect(instantToLocal(utc('2026-03-10T02:30:00Z'), SP)).toEqual({ date: '2026-03-09', time: '23:30', weekday: 1 });
  });
});

describe('datas locais', () => {
  it('validação', () => {
    expect(isDate('2026-02-28')).toBe(true);
    expect(isDate('2028-02-29')).toBe(true);
    expect(isDate('2026-02-29')).toBe(false);
    expect(isDate('2026-13-01')).toBe(false);
    expect(isTime('00:00')).toBe(true);
    expect(isTime('23:59')).toBe(true);
    expect(isTime('24:00')).toBe(true);
    expect(isTime('24:01')).toBe(false);
    expect(isTime('9:00')).toBe(false);
  });
  it('soma de dias, intervalo, semana e dia da semana', () => {
    expect(addDays('2026-02-27', 2)).toBe('2026-03-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(daysBetween('2026-03-10', '2026-03-15')).toBe(5);
    expect(dateRange('2026-03-09', '2026-03-12')).toEqual(['2026-03-09', '2026-03-10', '2026-03-11', '2026-03-12']);
    expect(weekdayOf('2026-03-08')).toBe(0); // domingo
    expect(weekdayOf('2026-03-14')).toBe(6); // sábado
    expect(weekStart('2026-03-08')).toBe('2026-03-02'); // domingo pertence à semana que começa na segunda anterior
    expect(weekStart('2026-03-09')).toBe('2026-03-09');
    expect(weekStart('2026-03-15')).toBe('2026-03-09');
  });
  it('minutos ↔ HH:MM', () => {
    expect(toMinutes('09:30')).toBe(570);
    expect(fromMinutes(570)).toBe('09:30');
    expect(fromMinutes(0)).toBe('00:00');
    expect(toMinutes('24:00')).toBe(1440);
  });
  it('formatação em pt-BR no fuso da empresa', () => {
    expect(formatDateBR('2026-03-05')).toBe('05/03/2026');
    expect(formatDateLong('2026-03-10')).toBe('terça-feira, 10/03/2026');
    expect(formatInstant(utc('2026-03-10T13:00:00Z'), SP)).toBe('10/03/2026 às 10:00');
    expect(formatInstant(utc('2026-03-10T02:30:00Z'), SP)).toBe('09/03/2026 às 23:30');
  });
});
