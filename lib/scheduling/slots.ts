// Motor de horários (espelho TypeScript do SQL private.ag_windows / ag_check_slot / ag_list_slots — a fonte de verdade para gravar é SEMPRE o banco).
// Uso na aplicação: sombrear o expediente na agenda e explicar indisponibilidade; nos testes: fixar as regras em exemplos legíveis.
// Regras: exceção por data SUBSTITUI o dia · bloqueios e reservas ativas são subtraídos · a ocupação [início − buffer anterior, fim + buffer posterior)
// precisa caber INTEIRA na janela · o passo só define a grade de inícios (a partir do começo da janela) · intervalo semiaberto [início, fim).
import { addDays, dateRange, instantToLocal, localToInstant, weekdayOf } from './time';

export type WeeklyRule = { weekday: number; start: string; end: string; active?: boolean };
/** Linha sem horários = dia fechado. */
export type DayOverride = { date: string; start: string | null; end: string | null };
export type Availability = { rules: WeeklyRule[]; overrides: DayOverride[] };
export type Busy = { startMs: number; endMs: number };
export type ServiceShape = { duration: number; before: number; after: number };
export type SlotSettings = { tz: string; stepMinutes: number; minNoticeMinutes: number; horizonDays: number };
export type Window = { startMs: number; endMs: number };

const MIN = 60_000;

/** Janelas de atendimento de um dia local, em ordem. */
export function windowsFor(date: string, av: Availability, tz: string): Window[] {
  const ov = av.overrides.filter((o) => o.date === date);
  const spans = ov.length > 0
    ? ov.filter((o) => o.start !== null && o.end !== null).map((o) => ({ start: o.start!, end: o.end! }))
    : av.rules.filter((r) => r.active !== false && r.weekday === weekdayOf(date)).map((r) => ({ start: r.start, end: r.end }));
  return spans.map((s) => ({ startMs: localToInstant(date, s.start, tz), endMs: localToInstant(date, s.end, tz) })).sort((a, b) => a.startMs - b.startMs);
}

const overlaps = (a: Busy, b: Busy): boolean => a.startMs < b.endMs && b.startMs < a.endMs;

/** Fim do último dia aberto para reservas públicas (exclusivo): meia-noite local de (hoje + horizonte + 1). */
export function horizonEnd(nowMs: number, s: SlotSettings): number {
  const today = instantToLocal(nowMs, s.tz).date;
  return localToInstant(addDays(today, s.horizonDays + 1), '00:00', s.tz);
}

export type SlotReason = 'past' | 'notice' | 'horizon' | 'outside' | 'conflict';

/** NULL = pode reservar. Mesma ordem de verificação do banco. */
export function checkSlot(p: { startMs: number; nowMs: number; isPublic: boolean; av: Availability; busy: Busy[]; svc: ServiceShape; settings: SlotSettings }): SlotReason | null {
  const { startMs, nowMs, isPublic, av, busy, svc, settings } = p;
  if (startMs <= nowMs) return 'past';
  if (isPublic) {
    if (startMs < nowMs + settings.minNoticeMinutes * MIN) return 'notice';
    if (startMs >= horizonEnd(nowMs, settings)) return 'horizon';
  }
  const occ: Busy = { startMs: startMs - svc.before * MIN, endMs: startMs + (svc.duration + svc.after) * MIN };
  const date = instantToLocal(startMs, settings.tz).date;
  const fits = windowsFor(date, av, settings.tz).some((w) => w.startMs <= occ.startMs && occ.endMs <= w.endMs
    && (!isPublic || Math.round((startMs - w.startMs) / MIN) % settings.stepMinutes === 0));
  if (!fits) return 'outside';
  if (busy.some((b) => overlaps(b, occ))) return 'conflict';
  return null;
}

/** Horários livres por dia local (ms UTC). */
export function listSlots(p: { from: string; to: string; nowMs: number; isPublic: boolean; av: Availability; busy: Busy[]; svc: ServiceShape; settings: SlotSettings }): Array<{ date: string; startMs: number }> {
  const { from, to, nowMs, isPublic, av, busy, svc, settings } = p;
  const out: Array<{ date: string; startMs: number }> = [];
  if (to < from) return out;
  const end = to > addDays(from, 62) ? addDays(from, 62) : to;
  const hz = horizonEnd(nowMs, settings);
  for (const date of dateRange(from, end)) {
    for (const w of windowsFor(date, av, settings.tz)) {
      const steps = Math.floor((w.endMs - w.startMs) / MIN / settings.stepMinutes);
      for (let k = 0; k <= steps; k++) {
        const s = w.startMs + k * settings.stepMinutes * MIN;
        if (s - svc.before * MIN < w.startMs) continue;
        if (s + (svc.duration + svc.after) * MIN > w.endMs) break;
        if (s <= nowMs) continue;
        if (isPublic && (s < nowMs + settings.minNoticeMinutes * MIN || s >= hz)) continue;
        const occ: Busy = { startMs: s - svc.before * MIN, endMs: s + (svc.duration + svc.after) * MIN };
        if (busy.some((b) => overlaps(b, occ))) continue;
        out.push({ date, startMs: s });
      }
    }
  }
  return out;
}
