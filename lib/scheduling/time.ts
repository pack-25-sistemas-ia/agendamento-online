// Fuso horário da empresa sem dependências: tudo sobre Intl. Instantes são milissegundos UTC; datas locais são «AAAA-MM-DD»; horas locais «HH:MM».
// Política para horário de verão (idêntica à do banco/Postgres, ver docs/DECISIONS.md D-A5):
//  · hora local INEXISTENTE (salto) → deslocada para frente, usando o deslocamento anterior à mudança;
//  · hora local AMBÍGUA (volta)     → vale a ocorrência POSTERIOR (horário padrão).
const MIN = 60_000;
const DAY = 86_400_000;

const cache = new Map<string, Intl.DateTimeFormat>();
function dtf(tz: string): Intl.DateTimeFormat {
  let f = cache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    cache.set(tz, f);
  }
  return f;
}

export function isValidTimeZone(tz: string): boolean {
  try { dtf(tz).format(0); return true; } catch { return false; }
}

type Parts = { y: number; m: number; d: number; h: number; mi: number; s: number };
function partsAt(ms: number, tz: string): Parts {
  const o: Record<string, number> = {};
  for (const p of dtf(tz).formatToParts(new Date(ms))) if (p.type !== 'literal') o[p.type] = Number(p.value);
  return { y: o.year!, m: o.month!, d: o.day!, h: o.hour! === 24 ? 0 : o.hour!, mi: o.minute!, s: o.second! };
}

/** Deslocamento do fuso (minutos a leste de UTC) no instante informado. */
export function offsetMinutesAt(ms: number, tz: string): number {
  const t = Math.floor(ms / 1000) * 1000;
  const p = partsAt(t, tz);
  return Math.round((Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - t) / MIN);
}

const pad = (n: number): string => String(n).padStart(2, '0');
export const isDate = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
export const isTime = (s: string): boolean => /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/.test(s);

/** Instante (ms UTC) da data/hora LOCAL da empresa. Aceita «24:00» (fim do dia). */
export function localToInstant(date: string, hhmm: string, tz: string): number {
  if (!isDate(date) || !isTime(hhmm)) throw new RangeError('data ou hora local inválida');
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [h, mi] = hhmm.split(':').map(Number) as [number, number];
  const localUtc = Date.UTC(y, m - 1, d, h, mi, 0);
  const before = offsetMinutesAt(localUtc - DAY, tz);
  const after = offsetMinutesAt(localUtc + DAY, tz);
  const valid = [...new Set([before, after])].map((o) => ({ o, inst: localUtc - o * MIN })).filter((c) => offsetMinutesAt(c.inst, tz) === c.o);
  if (valid.length === 2) return Math.max(valid[0]!.inst, valid[1]!.inst); // ambígua: ocorrência posterior
  if (valid.length === 1) return valid[0]!.inst;
  return localUtc - before * MIN; // inexistente: desloca para frente
}

export type LocalParts = { date: string; time: string; weekday: number };
/** Data, hora e dia da semana (0 = domingo) locais de um instante. */
export function instantToLocal(ms: number, tz: string): LocalParts {
  const p = partsAt(ms, tz);
  const date = `${p.y}-${pad(p.m)}-${pad(p.d)}`;
  return { date, time: `${pad(p.h)}:${pad(p.mi)}`, weekday: new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay() };
}

export function addDays(date: string, n: number): string {
  const t = Date.parse(`${date}T00:00:00Z`) + n * DAY;
  return new Date(t).toISOString().slice(0, 10);
}
export const weekdayOf = (date: string): number => new Date(`${date}T00:00:00Z`).getUTCDay();
export const daysBetween = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from, i = 0; d <= to && i < 400; d = addDays(d, 1), i++) out.push(d);
  return out;
}
/** Segunda-feira da semana da data. */
export const weekStart = (date: string): string => addDays(date, -((weekdayOf(date) + 6) % 7));

export const toMinutes = (hhmm: string): number => { const [h, m] = hhmm.split(':').map(Number) as [number, number]; return h * 60 + m; };
export const fromMinutes = (n: number): string => `${pad(Math.floor(n / 60))}:${pad(n % 60)}`;

// ---------------------------------------------------------------------------- exibição (pt-BR, sempre no fuso da empresa)
const WEEKDAYS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'] as const;
export const weekdayName = (n: number): string => WEEKDAYS[n] ?? '';
export const weekdayShort = (n: number): string => (WEEKDAYS[n] ?? '').slice(0, 3);
export const formatDateBR = (date: string): string => { const [y, m, d] = date.split('-'); return `${d}/${m}/${y}`; };
export const formatDateLong = (date: string): string => `${weekdayName(weekdayOf(date))}, ${formatDateBR(date)}`;
export function formatInstant(ms: number, tz: string): string { const l = instantToLocal(ms, tz); return `${formatDateBR(l.date)} às ${l.time}`; }
export function formatTimeOf(ms: number, tz: string): string { return instantToLocal(ms, tz).time; }
