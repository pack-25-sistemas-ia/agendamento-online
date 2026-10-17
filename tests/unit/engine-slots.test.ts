// Motor de horários: janelas, exceções, bloqueios, duração + intervalos (buffers), passo, antecedência, horizonte e fuso.
// Os valores esperados são OS MESMOS dos testes SQL (supabase/tests/50_ag_domain.sql e 55_ag_time_dashboard.sql): o espelho TS e o banco não podem divergir.
import { describe, expect, it } from 'vitest';
import { checkSlot, horizonEnd, listSlots, windowsFor, type Availability, type Busy, type ServiceShape, type SlotSettings } from '@/lib/scheduling/slots';
import { instantToLocal, localToInstant } from '@/lib/scheduling/time';

const SP = 'America/Sao_Paulo';
const NY = 'America/New_York';
const MIN = 60_000;
const settings = (over: Partial<SlotSettings> = {}): SlotSettings => ({ tz: SP, stepMinutes: 30, minNoticeMinutes: 120, horizonDays: 60, ...over });
const allDays = (...spans: Array<[string, string]>): Availability => ({ rules: [0, 1, 2, 3, 4, 5, 6].flatMap((weekday) => spans.map(([start, end]) => ({ weekday, start, end }))), overrides: [] });
const AV = allDays(['09:00', '12:00'], ['13:00', '18:00']);
const CORTE: ServiceShape = { duration: 60, before: 10, after: 15 };
const RETOQUE: ServiceShape = { duration: 30, before: 0, after: 0 };
const D = '2027-03-10'; // quarta-feira
const NOW = localToInstant('2027-03-01', '08:00', SP);
const at = (date: string, hhmm: string, tz = SP): number => localToInstant(date, hhmm, tz);
const times = (r: Array<{ startMs: number }>, tz = SP): string[] => r.map((s) => instantToLocal(s.startMs, tz).time);
const free = (svc: ServiceShape, busy: Busy[] = [], av = AV, date = D, over: Partial<SlotSettings> = {}) =>
  listSlots({ from: date, to: date, nowMs: NOW, isPublic: false, av, busy, svc, settings: settings(over) });

describe('janelas', () => {
  it('regra semanal; exceção por data SUBSTITUI o dia; dia fechado não tem janela', () => {
    const av: Availability = { rules: [{ weekday: 3, start: '09:00', end: '12:00' }], overrides: [{ date: '2027-03-10', start: '15:00', end: '17:00' }, { date: '2027-03-17', start: null, end: null }] };
    expect(windowsFor('2027-03-03', av, SP).map((w) => instantToLocal(w.startMs, SP).time)).toEqual(['09:00']);
    expect(windowsFor('2027-03-10', av, SP).map((w) => [instantToLocal(w.startMs, SP).time, instantToLocal(w.endMs, SP).time])).toEqual([['15:00', '17:00']]);
    expect(windowsFor('2027-03-17', av, SP)).toEqual([]);
    expect(windowsFor('2027-03-09', av, SP)).toEqual([]); // sem regra na terça
  });
  it('regra inativa não conta; várias janelas no dia saem em ordem', () => {
    const av: Availability = { rules: [{ weekday: 3, start: '13:00', end: '18:00' }, { weekday: 3, start: '09:00', end: '12:00' }, { weekday: 3, start: '19:00', end: '20:00', active: false }], overrides: [] };
    expect(windowsFor(D, av, SP)).toHaveLength(2);
    expect(windowsFor(D, av, SP)[0]!.startMs).toBe(at(D, '09:00'));
  });
  it('janela até 24:00 termina na meia-noite seguinte', () => {
    const av: Availability = { rules: [{ weekday: 3, start: '22:00', end: '24:00' }], overrides: [] };
    expect(windowsFor(D, av, SP)[0]!.endMs).toBe(at('2027-03-11', '00:00'));
  });
});

describe('horários livres: duração e intervalos (buffers)', () => {
  it('corte completo 60 + 10 antes + 15 depois: a OCUPAÇÃO inteira precisa caber na janela', () => {
    expect(times(free(CORTE))).toEqual(['09:30', '10:00', '10:30', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30']);
  });
  it('retoque de 30 min sem intervalos: 09:00…11:30 e 13:00…17:30', () => {
    const r = times(free(RETOQUE));
    expect(r).toHaveLength(16);
    expect(r[0]).toBe('09:00');
    expect(r[5]).toBe('11:30');
    expect(r[6]).toBe('13:00');
    expect(r[15]).toBe('17:30');
  });
  it('passo menor não altera a duração do serviço, só cria mais inícios', () => {
    expect(times(free(RETOQUE, [], AV, D, { stepMinutes: 15 })).slice(0, 4)).toEqual(['09:00', '09:15', '09:30', '09:45']);
    expect(times(free(CORTE, [], AV, D, { stepMinutes: 60 }))).toEqual(['10:00', '14:00', '15:00', '16:00']);
  });
  it('reserva ocupa [início − buffer anterior, fim + buffer posterior): 10:00 → 09:50–11:15; o adjacente 11:15 é permitido', () => {
    const busy: Busy[] = [{ startMs: at(D, '09:50'), endMs: at(D, '11:15') }];
    const t = times(free(RETOQUE, busy));
    expect(t).not.toContain('10:00');
    expect(t).not.toContain('09:30');
    expect(t).not.toContain('11:00');
    expect(t).toContain('09:00'); // termina às 09:30, antes de 09:50
    // com passo de 15 min, 11:15 cabe exatamente: o fim da ocupação anterior encosta no início (intervalo semiaberto)
    expect(times(free(RETOQUE, busy, AV, D, { stepMinutes: 15 }))).toContain('11:15');
    expect(times(free(RETOQUE, busy, AV, D, { stepMinutes: 15 }))).not.toContain('11:00');
  });
  it('bloqueio da manhã inteira remove os 6 horários da manhã', () => {
    expect(free(RETOQUE, [{ startMs: at(D, '09:00'), endMs: at(D, '12:00') }])).toHaveLength(10);
  });
  it('profissional sem janela no dia não tem horários; intervalo menor que o serviço também não', () => {
    expect(free(RETOQUE, [], { rules: [], overrides: [] })).toEqual([]);
    expect(free({ duration: 120, before: 0, after: 0 }, [], allDays(['09:00', '10:30']))).toEqual([]);
  });
});

describe('antecedência, horizonte e passado', () => {
  const pub = (nowMs: number, over: Partial<SlotSettings> = {}, date = D) => listSlots({ from: date, to: date, nowMs, isPublic: true, av: AV, busy: [], svc: RETOQUE, settings: settings(over) });
  it('nunca oferece o passado nem horários antes da antecedência mínima', () => {
    const now = at(D, '10:00');
    expect(times(listSlots({ from: D, to: D, nowMs: now, isPublic: false, av: AV, busy: [], svc: RETOQUE, settings: settings() })).slice(0, 2)).toEqual(['10:30', '11:00']);
    // 10:00 + 2 h de antecedência = 12:00; a manhã termina às 12:00, então o primeiro horário público é 13:00
    expect(times(pub(now)).slice(0, 2)).toEqual(['13:00', '13:30']);
    expect(pub(now, { minNoticeMinutes: 0 })[0]).toBeDefined();
  });
  it('horizonte: o último dia aberto é hoje + N (inclusive)', () => {
    const now = at('2027-03-01', '08:00');
    expect(pub(now, { horizonDays: 5 }, '2027-03-06')).not.toHaveLength(0);
    expect(pub(now, { horizonDays: 5 }, '2027-03-07')).toEqual([]);
    expect(horizonEnd(now, settings({ horizonDays: 5 }))).toBe(at('2027-03-07', '00:00'));
  });
  it('público respeita a grade de inícios a partir do começo da janela', () => {
    const grid = checkSlot({ startMs: at(D, '10:15'), nowMs: NOW, isPublic: true, av: AV, busy: [], svc: RETOQUE, settings: settings() });
    expect(grid).toBe('outside');
    expect(checkSlot({ startMs: at(D, '10:15'), nowMs: NOW, isPublic: false, av: AV, busy: [], svc: RETOQUE, settings: settings() })).toBeNull(); // equipe pode marcar qualquer minuto da janela
  });
});

describe('validação de um horário (mesmos motivos do banco)', () => {
  const base = { nowMs: NOW, isPublic: false, av: AV, busy: [] as Busy[], svc: CORTE, settings: settings() };
  it('past · outside · conflict · ok', () => {
    expect(checkSlot({ ...base, startMs: NOW - MIN })).toBe('past');
    expect(checkSlot({ ...base, startMs: NOW })).toBe('past');
    expect(checkSlot({ ...base, startMs: at(D, '08:00') })).toBe('outside');
    expect(checkSlot({ ...base, startMs: at(D, '09:00') })).toBe('outside'); // 09:00 − 10 min de intervalo cai antes da janela
    expect(checkSlot({ ...base, startMs: at(D, '11:30') })).toBe('outside'); // 11:30 + 75 min passa do meio-dia
    expect(checkSlot({ ...base, startMs: at(D, '12:30') })).toBe('outside'); // almoço
    expect(checkSlot({ ...base, startMs: at(D, '10:00') })).toBeNull();
    expect(checkSlot({ ...base, startMs: at(D, '10:00'), busy: [{ startMs: at(D, '10:30'), endMs: at(D, '11:00') }] })).toBe('conflict');
    expect(checkSlot({ ...base, startMs: at(D, '10:00'), busy: [{ startMs: at(D, '11:15'), endMs: at(D, '12:00') }] })).toBeNull(); // encosta, não sobrepõe
  });
  it('notice · horizon (só reserva pública)', () => {
    const now = at(D, '10:00');
    expect(checkSlot({ ...base, nowMs: now, isPublic: true, startMs: at(D, '11:30'), svc: RETOQUE })).toBe('notice');
    expect(checkSlot({ ...base, nowMs: now, isPublic: false, startMs: at(D, '11:00'), svc: RETOQUE })).toBeNull();
    expect(checkSlot({ ...base, isPublic: true, startMs: at('2027-06-10', '10:00'), svc: RETOQUE, settings: settings({ horizonDays: 30 }) })).toBe('horizon');
  });
});

describe('horário de verão (fuso America/New_York): mesmos resultados do banco', () => {
  const ny = (date: string, rules: Availability['rules']) => listSlots({ from: date, to: date, nowMs: at('2027-03-01', '08:00', NY), isPublic: false, av: { rules, overrides: [] }, busy: [], svc: RETOQUE, settings: settings({ tz: NY }) });
  const utcTimes = (r: Array<{ startMs: number }>) => r.map((s) => new Date(s.startMs).toISOString().slice(11, 16));
  it('SALTO: janela 01:00–05:00 dura 3 h reais e não tem 02:xx', () => {
    const r = ny('2027-03-14', [{ weekday: 0, start: '01:00', end: '05:00' }]);
    expect(utcTimes(r)).toEqual(['06:00', '06:30', '07:00', '07:30', '08:00', '08:30']);
    expect(times(r, NY)).toEqual(['01:00', '01:30', '03:00', '03:30', '04:00', '04:30']);
  });
  it('início dentro do salto é deslocado para frente (02:30 → 03:30)', () => {
    expect(utcTimes(ny('2027-03-14', [{ weekday: 0, start: '02:30', end: '04:00' }]))).toEqual(['07:30']);
  });
  it('VOLTA: janela 00:30–03:00 dura 3,5 h reais; 01:00 e 01:30 aparecem duas vezes (instantes diferentes)', () => {
    const r = ny('2027-11-07', [{ weekday: 0, start: '00:30', end: '03:00' }]);
    expect(utcTimes(r)).toEqual(['04:30', '05:00', '05:30', '06:00', '06:30', '07:00', '07:30']);
    expect(times(r, NY)).toEqual(['00:30', '01:00', '01:30', '01:00', '01:30', '02:00', '02:30']);
  });
  it('início ambíguo usa a ocorrência posterior', () => {
    expect(utcTimes(ny('2027-11-07', [{ weekday: 0, start: '01:30', end: '03:00' }]))[0]).toBe('06:30');
  });
});
