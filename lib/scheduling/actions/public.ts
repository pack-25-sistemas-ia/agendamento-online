'use server';

import { z } from 'zod';
import { fail, type ActionState } from '@/lib/actions/result';
import { logEvent } from '@/lib/log';
import { isDate } from '../time';
import { dbMessage, formObject, parse } from '../action-kit';
import { limited, publicClient, requesterId } from '../public-db';
import { deriveBookingToken } from '../token';

// Operações PÚBLICAS (sem sessão). Falam com o banco como `anon`, que só alcança funções ag_public_*; o banco revalida tudo.
// Nunca confiamos em preço, duração, empresa ou horário final vindos do navegador. Erros devolvem mensagens amigáveis, sem detalhes internos.

export type PublicSlots = { ok: boolean; message?: string; timezone?: string; days?: Array<{ date: string; times: string[] }> };

const slotsSchema = z.object({
  slug: z.string().min(2).max(60).regex(/^[a-z0-9-]+$/i),
  service: z.string().uuid(),
  professional: z.string().uuid(),
  from: z.string().refine(isDate),
  to: z.string().refine(isDate),
});

export async function publicSlots(input: { slug: string; service: string; professional: string; from: string; to: string }): Promise<PublicSlots> {
  const p = slotsSchema.safeParse(input);
  if (!p.success) return { ok: false, message: 'Pedido inválido.' };
  const { ip } = await requesterId();
  const rl = limited('slots', ip);
  if (!rl.allowed) return { ok: false, message: `Muitas consultas em pouco tempo. Aguarde ${rl.retryAfterSeconds}s.` };
  const { data, error } = await publicClient().rpc('ag_public_slots', { p_slug: p.data.slug, p_svc: p.data.service, p_prof: p.data.professional, p_from: p.data.from, p_to: p.data.to });
  if (error) return { ok: false, message: dbMessage(error) };
  if (!data) return { ok: false, message: 'Página de reservas indisponível.' };
  const d = data as { timezone: string; days: Array<{ date: string; times: string[] }> };
  return { ok: true, timezone: d.timezone, days: d.days };
}

const bookSchema = z.object({
  slug: z.string().min(2).max(60).regex(/^[a-z0-9-]+$/i),
  service: z.string().uuid('Escolha o serviço.'),
  professional: z.string().uuid('Escolha o profissional.'),
  slot: z.string().min(20).max(40).refine((s) => !Number.isNaN(Date.parse(s)), 'Escolha um horário.'),
  name: z.string().trim().min(2, 'Informe seu nome.').max(120, 'Nome longo demais.'),
  phone: z.string().trim().max(30, 'Telefone longo demais.').optional(),
  email: z.string().trim().max(200, 'E-mail longo demais.').optional(),
  consent: z.literal('on', { message: 'Confirme que está de acordo para reservar.' }),
  idem: z.string().uuid('Solicitação inválida. Recarregue a página.'),
});

export async function publicBook(_prev: ActionState, fd: FormData): Promise<ActionState & { redirectTo?: string }> {
  const values = formObject(fd);
  delete values.idem; // a chave é gerada pelo hook; nunca devolvida ao formulário
  const p = parse(bookSchema, formObject(fd), values);
  if (!p.ok) return p.state;
  const d = p.data;
  if (!d.phone && !d.email) return fail('Informe um telefone ou e-mail para contato.', { phone: ['Informe um telefone ou e-mail.'] }, values);
  const { ip, key } = await requesterId();
  const rl = limited('book', ip);
  if (!rl.allowed) return fail(`Muitas tentativas em pouco tempo. Aguarde ${Math.ceil(rl.retryAfterSeconds / 60)} min e tente de novo.`, undefined, values);
  let token: string;
  try { token = deriveBookingToken(d.idem); } catch (e) {
    logEvent('error', 'ag_booking_secret_missing', { name: e instanceof Error ? e.name : 'unknown' });
    return fail('A reserva online está temporariamente indisponível. Fale com a empresa.', undefined, values);
  }
  const { error } = await publicClient().rpc('ag_public_book', {
    p_slug: d.slug, p_svc: d.service, p_prof: d.professional, p_start: new Date(d.slot).toISOString(), p_name: d.name, p_phone: d.phone || null, p_email: d.email || null,
    p_consent: true, p_idem: d.idem, p_token: token, p_client: key,
  });
  if (error) {
    const stale = error.code === '23P01' || /acabou de ser reservado/.test(error.message ?? '');
    return { ...fail(dbMessage(error), stale ? { slot: ['Escolha outro horário.'] } : undefined, values), ...(stale ? { values: { ...values, slot: '' } } : {}) };
  }
  return { ok: true, message: 'Reserva confirmada!', redirectTo: `/reserva/${token}?nova=1` };
}

// ---- gerenciamento pelo link (token de 256 bits na URL; o banco só conhece o hash)
const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{40,128}$/);

export async function publicCancel(_prev: ActionState, fd: FormData): Promise<ActionState & { redirectTo?: string }> {
  const t = tokenSchema.safeParse(fd.get('token'));
  if (!t.success) return fail('Link inválido ou expirado.');
  const { ip } = await requesterId();
  const rl = limited('token', ip);
  if (!rl.allowed) return fail(`Muitas tentativas. Aguarde ${Math.ceil(rl.retryAfterSeconds / 60)} min.`);
  const { error } = await publicClient().rpc('ag_public_cancel', { p_token: t.data });
  if (error) return fail(dbMessage(error));
  return { ok: true, message: 'Reserva cancelada.', redirectTo: `/reserva/${t.data}?cancelada=1` };
}

export async function publicBookingSlots(token: string, from: string, to: string): Promise<PublicSlots> {
  const t = tokenSchema.safeParse(token);
  if (!t.success || !isDate(from) || !isDate(to)) return { ok: false, message: 'Pedido inválido.' };
  const { ip } = await requesterId();
  const rl = limited('slots', ip);
  if (!rl.allowed) return { ok: false, message: `Muitas consultas em pouco tempo. Aguarde ${rl.retryAfterSeconds}s.` };
  const { data, error } = await publicClient().rpc('ag_public_booking_slots', { p_token: t.data, p_from: from, p_to: to });
  if (error) return { ok: false, message: dbMessage(error) };
  if (!data) return { ok: false, message: 'Link inválido ou expirado.' };
  const d = data as { timezone: string; days: Array<{ date: string; times: string[] }> };
  return { ok: true, timezone: d.timezone, days: d.days };
}

export async function publicReschedule(_prev: ActionState, fd: FormData): Promise<ActionState & { redirectTo?: string }> {
  const t = tokenSchema.safeParse(fd.get('token'));
  const slot = z.string().min(20).max(40).refine((s) => !Number.isNaN(Date.parse(s))).safeParse(fd.get('slot'));
  if (!t.success) return fail('Link inválido ou expirado.');
  if (!slot.success) return fail('Escolha o novo horário.', { slot: ['Escolha um dos horários livres.'] });
  const { ip } = await requesterId();
  const rl = limited('token', ip);
  if (!rl.allowed) return fail(`Muitas tentativas. Aguarde ${Math.ceil(rl.retryAfterSeconds / 60)} min.`);
  const { error } = await publicClient().rpc('ag_public_reschedule', { p_token: t.data, p_start: new Date(slot.data).toISOString() });
  if (error) return fail(dbMessage(error), error.code === '23P01' ? { slot: ['Escolha outro horário.'] } : undefined);
  return { ok: true, message: 'Reserva reagendada.', redirectTo: `/reserva/${t.data}?reagendada=1` };
}
