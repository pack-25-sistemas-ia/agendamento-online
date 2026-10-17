'use server';

import { z } from 'zod';
import { fail, succeed, type ActionState } from '@/lib/actions/result';
import { isDate, isTime, localToInstant } from '../time';
import { bust, dbMessage, formObject, guarded, parse, type SaveResult } from '../action-kit';

const uuid = z.string().uuid('Registro inválido.');
const hhmm = z.string().refine((s) => isTime(s), 'Horário inválido (use HH:MM).');
const interval = z.object({ start: hhmm, end: hhmm }).refine((i) => i.start < i.end, 'O fim deve ser depois do início.');

/** Disponibilidade semanal: o formulário envia um JSON com os intervalos (editor dinâmico) — validado de novo aqui e no banco. */
const weeklySchema = z.object({
  prof: uuid,
  rules: z.string().max(8000).transform((s, ctx) => {
    try { return JSON.parse(s) as unknown; } catch { ctx.addIssue({ code: 'custom', message: 'Intervalos inválidos.' }); return z.NEVER; }
  }).pipe(z.array(z.object({ weekday: z.number().int().min(0).max(6), start: hhmm, end: hhmm })).max(56, 'Informe até 56 intervalos.')),
});

export async function saveWeekly(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  const values = formObject(fd);
  const p = parse(weeklySchema, values, values);
  if (!p.ok) return p.state;
  for (const r of p.data.rules) if (r.start >= r.end) return fail(`Em cada intervalo o fim deve ser depois do início (${r.start}–${r.end}).`, undefined, values);
  return guarded('manager', 'saveWeekly', async ({ ctx, org }) => {
    const { error } = await ctx.supabase.rpc('ag_save_weekly', { p_org: org, p_prof: p.data.prof, p_rules: p.data.rules });
    if (error) return fail(dbMessage(error), undefined, values);
    bust('/disponibilidade', '/agenda');
    return succeed('Disponibilidade semanal salva. Reservas já feitas não são alteradas.');
  });
}

const overrideSchema = z.object({
  prof: uuid,
  date: z.string().refine(isDate, 'Informe uma data válida.'),
  mode: z.enum(['closed', 'hours'], { message: 'Escolha entre dia fechado ou horários próprios.' }),
  intervals: z.string().max(2000).optional(),
});

export async function saveOverride(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  const values = formObject(fd);
  const p = parse(overrideSchema, values, values);
  if (!p.ok) return p.state;
  let intervals: Array<{ start: string; end: string }> = [];
  if (p.data.mode === 'hours') {
    try { intervals = z.array(interval).min(1, 'Informe ao menos um intervalo.').max(8).parse(JSON.parse(p.data.intervals ?? '[]')); } catch (e) {
      return fail(e instanceof z.ZodError ? (e.issues[0]?.message ?? 'Intervalos inválidos.') : 'Intervalos inválidos.', undefined, values);
    }
  }
  return guarded('manager', 'saveOverride', async ({ ctx, org }) => {
    const { error } = await ctx.supabase.rpc('ag_save_override_day', { p_org: org, p_prof: p.data.prof, p_date: p.data.date, p_closed: p.data.mode === 'closed', p_intervals: intervals });
    if (error) return fail(dbMessage(error), undefined, values);
    bust('/disponibilidade', '/agenda');
    return succeed('Exceção salva: nesta data valem somente estes horários (a regra semanal não se aplica).');
  });
}

export async function deleteOverride(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  const prof = uuid.safeParse(fd.get('prof'));
  const date = z.string().refine(isDate).safeParse(fd.get('date'));
  if (!prof.success || !date.success) return fail('Dados inválidos.');
  return guarded('manager', 'deleteOverride', async ({ ctx, org }) => {
    const { error } = await ctx.supabase.rpc('ag_delete_override_day', { p_org: org, p_prof: prof.data, p_date: date.data });
    if (error) return fail(dbMessage(error));
    bust('/disponibilidade', '/agenda');
    return succeed('Exceção removida: volta a valer a disponibilidade semanal.');
  });
}

const blockSchema = z.object({
  prof: uuid,
  tz: z.string().max(60),
  start_date: z.string().refine(isDate, 'Informe a data inicial.'),
  start_time: hhmm,
  end_date: z.string().refine(isDate, 'Informe a data final.'),
  end_time: hhmm,
  reason: z.string().trim().max(200, 'Motivo longo demais (máx. 200).').optional(),
});

export async function createBlock(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  const values = formObject(fd);
  const p = parse(blockSchema, values, values);
  if (!p.ok) return p.state;
  return guarded('manager', 'createBlock', async ({ ctx, org }) => {
    // o fuso vem do banco (nunca do navegador)
    const { data: tzData } = await ctx.supabase.from('scheduling_settings').select('timezone').eq('organization_id', org).maybeSingle();
    const tz = (tzData as { timezone: string } | null)?.timezone ?? 'America/Sao_Paulo';
    const d = p.data;
    const startMs = localToInstant(d.start_date, d.start_time, tz);
    const endMs = localToInstant(d.end_date, d.end_time, tz);
    if (endMs <= startMs) return fail('O fim do bloqueio deve ser depois do início.', { end_date: ['O fim deve ser depois do início.'] }, values);
    const { error } = await ctx.supabase.rpc('ag_create_block', { p_org: org, p_prof: d.prof, p_start: new Date(startMs).toISOString(), p_end: new Date(endMs).toISOString(), p_reason: d.reason || null });
    if (error) return fail(dbMessage(error), undefined, values);
    bust('/disponibilidade', '/agenda');
    return succeed('Bloqueio criado. O período deixa de ser oferecido para reservas.');
  });
}

export async function cancelBlock(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  const id = uuid.safeParse(fd.get('id'));
  if (!id.success) return fail('Bloqueio inválido.');
  return guarded('manager', 'cancelBlock', async ({ ctx, org }) => {
    const { error } = await ctx.supabase.rpc('ag_cancel_block', { p_org: org, p_entry: id.data });
    if (error) return fail(dbMessage(error));
    bust('/disponibilidade', '/agenda');
    return succeed('Bloqueio removido. O horário voltou a ficar disponível.');
  });
}

