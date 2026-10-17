// Limites exatos do motor de horários (semiaberto [início, fim)): o que está EXATAMENTE na borda é permitido, um minuto além não é.
import { describe, expect, it } from 'vitest';
import { checkSlot, listSlots, type Availability, type Busy, type ServiceShape, type SlotSettings } from '@/lib/scheduling/slots';
import { addDays, localToInstant } from '@/lib/scheduling/time';

const SP = 'America/Sao_Paulo';
const MIN = 60_000;
const settings: SlotSettings = { tz: SP, stepMinutes: 30, minNoticeMinutes: 120, horizonDays: 60 };
const AV: Availability = { rules: [0, 1, 2, 3, 4, 5, 6].flatMap((weekday) => [{ weekday, start: '09:00', end: '12:00' }, { weekday, start: '13:00', end: '18:00' }]), overrides: [] };
const D = '2027-03-10';
const NOW = localToInstant('2027-03-01', '08:00', SP);
const at = (hhmm: string): number => localToInstant(D, hhmm, SP);
const RETOQUE: ServiceShape = { duration: 30, before: 0, after: 0 };
const CORTE: ServiceShape = { duration: 60, before: 10, after: 15 };
const check = (startMs: number, svc: ServiceShape, busy: Busy[] = [], nowMs = NOW, isPublic = true) => checkSlot({ startMs, nowMs, isPublic, av: AV, busy, svc, settings });

describe('bordas da janela', () => {
  it('começar EXATAMENTE no início da janela é permitido', () => expect(check(at('09:00'), RETOQUE)).toBeNull());
  it('terminar EXATAMENTE no fim da janela é permitido; um passo além não', () => {
    expect(check(at('11:30'), RETOQUE)).toBeNull();
    expect(check(at('12:00'), RETOQUE)).toBe('outside'); // intervalo de almoço
    expect(check(at('17:30'), RETOQUE)).toBeNull();
    expect(check(at('18:00'), RETOQUE)).toBe('outside');
  });
  it('o intervalo anterior precisa caber na janela: corte às 09:00 sai da janela, às 09:30 cabe', () => {
    expect(check(at('09:00'), CORTE)).toBe('outside');
    expect(check(at('09:30'), CORTE)).toBeNull();
  });
});

describe('antecedência mínima exata', () => {
  it('faltando EXATAMENTE a antecedência mínima ainda pode reservar; um minuto a menos não', () => {
    const start = at('10:00');
    expect(check(start, RETOQUE, [], start - 120 * MIN)).toBeNull();
    expect(check(start, RETOQUE, [], start - 119 * MIN)).toBe('notice');
  });
});

describe('o intervalo posterior também ocupa a agenda', () => {
  it('outro compromisso que começa dentro do intervalo posterior (11:00–11:15) conflita', () => {
    const busy: Busy[] = [{ startMs: at('11:00'), endMs: at('11:30') }];
    expect(check(at('10:00'), CORTE, busy)).toBe('conflict'); // ocupação 09:50–11:15
    expect(check(at('10:00'), CORTE, [{ startMs: at('11:15'), endMs: at('11:45') }])).toBeNull(); // adjacente
  });
});

describe('período máximo de consulta', () => {
  it('a listagem é limitada a 62 dias a partir da data inicial', () => {
    const r = listSlots({ from: D, to: addDays(D, 400), nowMs: NOW, isPublic: false, av: AV, busy: [], svc: RETOQUE, settings });
    const days = [...new Set(r.map((s) => s.date))];
    expect(days[0]).toBe(D);
    expect(days.at(-1)).toBe(addDays(D, 62));
    expect(days).toHaveLength(63);
  });
});
