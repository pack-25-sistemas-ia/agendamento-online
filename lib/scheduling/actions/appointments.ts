'use server';

import { z } from 'zod';
import { fail, succeed, type ActionState } from '@/lib/actions/result';
import { bust, dbMessage, formObject, guarded, parse, type SaveResult } from '../action-kit';

const uuid = z.string().uuid('Registro inválido.');
const optUuid = z.union([uuid, z.literal('')]).transform((v) => (v === '' ? null : v));
/** Instante escolhido na lista de horários livres (ISO 8601). O servidor revalida tudo no banco: o navegador nunca decide disponibilidade. */
const slot = z.string().min(20, 'Escolha um dos horários livres.').max(40).refine((s) => !Number.isNaN(Date.parse(s)), 'Horário inválido.').transform((s) => new Date(s).toISOString());

const createSchema = z.object({
  prof: uuid,
  service: uuid,
  slot,
  customer: optUuid.optional(),
  new_name: z.string().trim().max(120).optional(),
  new_phone: z.string().trim().max(30).optional(),
  new_email: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(1000, 'Notas longas demais (máx. 1000).').optional(),
});

export async function createAppointment(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  const values = formObject(fd);
  const p = parse(createSchema, values, values);
  if (!p.ok) return p.state;
  const d = p.data;
  if (!d.customer && (d.new_name ?? '').length < 2) return fail('Escolha um cliente ou informe o nome do novo cliente.', { new_name: ['Informe o nome do cliente.'] }, values);
  return guarded('manager', 'createAppointment', async ({ ctx, org }) => {
    const { data, error } = await ctx.supabase.rpc('ag_create_appointment', {
      p_org: org, p_prof: d.prof, p_svc: d.service, p_customer: d.customer ?? null,
      p_new_customer: d.customer ? null : { name: d.new_name, phone: d.new_phone || null, email: d.new_email || null }, p_start: d.slot, p_notes: d.notes || null,
    });
    if (error) return fail(dbMessage(error), undefined, values);
    bust('/agenda', '/agendamentos', '/dashboard', '/clientes');
    return { ...succeed('Agendamento criado.'), id: data as string, redirectTo: `/agendamentos/${data as string}` };
  });
}

const rescheduleSchema = z.object({ appt: uuid, slot, prof: optUuid.optional() });

export async function rescheduleAppointment(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  const values = formObject(fd);
  const p = parse(rescheduleSchema, values, values);
  if (!p.ok) return p.state;
  return guarded('manager', 'rescheduleAppointment', async ({ ctx, org }) => {
    const { error } = await ctx.supabase.rpc('ag_reschedule_appointment', { p_org: org, p_appt: p.data.appt, p_start: p.data.slot, p_prof: p.data.prof ?? null });
    if (error) return fail(dbMessage(error), undefined, values);
    bust('/agenda', '/agendamentos', `/agendamentos/${p.data.appt}`, '/dashboard');
    return { ...succeed('Agendamento reagendado. O horário anterior foi liberado.'), redirectTo: `/agendamentos/${p.data.appt}` };
  });
}

const statusSchema = z.object({ appt: uuid, action: z.enum(['confirm', 'cancel', 'complete', 'no_show']), reason: z.string().trim().max(300, 'Motivo longo demais (máx. 300).').optional() });

export async function setStatus(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  const values = formObject(fd);
  const p = parse(statusSchema, values, values);
  if (!p.ok) return p.state;
  return guarded('staff', 'setStatus', async ({ ctx, org }) => {
    const { error } = await ctx.supabase.rpc('ag_set_status', { p_org: org, p_appt: p.data.appt, p_action: p.data.action, p_reason: p.data.reason || null });
    if (error) return fail(dbMessage(error), undefined, values);
    bust('/agenda', '/agendamentos', `/agendamentos/${p.data.appt}`, '/dashboard');
    const msg = { confirm: 'Agendamento confirmado.', cancel: 'Agendamento cancelado. O horário foi liberado.', complete: 'Atendimento marcado como concluído.', no_show: 'Não comparecimento registrado.' }[p.data.action];
    return succeed(msg);
  });
}

const notesSchema = z.object({ appt: uuid, notes: z.string().trim().max(1000, 'Notas longas demais (máx. 1000).') });

export async function updateNotes(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  const values = formObject(fd);
  const p = parse(notesSchema, values, values);
  if (!p.ok) return p.state;
  return guarded('staff', 'updateNotes', async ({ ctx, org }) => {
    const { error } = await ctx.supabase.rpc('ag_update_notes', { p_org: org, p_appt: p.data.appt, p_notes: p.data.notes || null });
    if (error) return fail(dbMessage(error), undefined, values);
    bust(`/agendamentos/${p.data.appt}`);
    return succeed('Notas internas salvas.');
  });
}

/** Emite outro link de gerenciamento (o anterior deixa de valer). O endereço completo só aparece nesta resposta. */
export async function reissueLink(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const appt = uuid.safeParse(fd.get('appt'));
  if (!appt.success) return fail('Atendimento inválido.');
  return guarded('manager', 'reissueLink', async ({ ctx, org }) => {
    const { data, error } = await ctx.supabase.rpc('ag_reissue_link', { p_org: org, p_appt: appt.data });
    if (error) return fail(dbMessage(error));
    const token = (data as { token: string }).token;
    const base = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '');
    bust(`/agendamentos/${appt.data}`);
    return { ok: true, message: 'Novo link emitido. O anterior deixou de valer. Copie e envie ao cliente.', values: { link: `${base}/reserva/${token}` } };
  });
}
