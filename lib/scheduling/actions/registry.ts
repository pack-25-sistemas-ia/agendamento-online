'use server';

import { z } from 'zod';
import { fail, succeed, type ActionState } from '@/lib/actions/result';
import { bust, dbMessage, formObject, guarded, parse, type SaveResult } from '../action-kit';
import { priceToCents } from '../money';

const uuid = z.string().uuid('Registro inválido.');
const optUuid = z.union([uuid, z.literal('')]).transform((v) => (v === '' ? null : v));
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Cor inválida (use #RRGGBB).');
const checkbox = z.union([z.literal('on'), z.literal('')]).optional().transform((v) => v === 'on');

const professionalSchema = z.object({
  id: optUuid.optional(),
  name: z.string().trim().min(2, 'Informe o nome (mínimo de 2 letras).').max(80, 'Nome longo demais (máx. 80).'),
  bio: z.string().trim().max(300, 'Apresentação longa demais (máx. 300).').optional(),
  color,
  active: checkbox,
  user: optUuid.optional(),
});

export async function saveProfessional(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  const values = formObject(fd);
  const p = parse(professionalSchema, values, values);
  if (!p.ok) return p.state;
  const services = fd.getAll('service').filter((x): x is string => typeof x === 'string' && z.string().uuid().safeParse(x).success);
  const hasUserField = fd.has('user_present'); // só o proprietário vê (e envia) o seletor de usuário
  return guarded('manager', 'saveProfessional', async ({ ctx, org, access }) => {
    const d = p.data;
    let linked: string | null | undefined = d.user ?? null;
    if (!hasUserField || access.profile !== 'owner') {
      // gestor não mexe no vínculo: preserva o atual
      if (d.id) {
        const { data } = await ctx.supabase.from('professionals').select('linked_user_id').eq('id', d.id).maybeSingle();
        linked = (data as { linked_user_id: string | null } | null)?.linked_user_id ?? null;
      } else linked = null;
    }
    const { data, error } = await ctx.supabase.rpc('ag_save_professional', { p_org: org, p_id: d.id ?? null, p_name: d.name, p_bio: d.bio || null, p_color: d.color, p_active: d.active ?? false, p_user: linked });
    if (error) return fail(dbMessage(error, 'Este usuário já está vinculado a outro profissional.'), undefined, values);
    const id = data as string;
    const r2 = await ctx.supabase.rpc('ag_set_professional_services', { p_org: org, p_prof: id, p_services: services });
    if (r2.error) return fail(dbMessage(r2.error), undefined, values);
    bust('/profissionais', '/disponibilidade', '/agenda', '/dashboard');
    return { ...succeed(d.id ? 'Profissional atualizado.' : 'Profissional cadastrado.'), id, redirectTo: d.id ? undefined : '/profissionais' };
  });
}

const serviceSchema = z.object({
  id: optUuid.optional(),
  name: z.string().trim().min(2, 'Informe o nome (mínimo de 2 letras).').max(80),
  description: z.string().trim().max(400, 'Descrição longa demais (máx. 400).').optional(),
  duration: z.coerce.number({ message: 'Informe a duração em minutos.' }).int().min(5, 'Duração mínima: 5 minutos.').max(720, 'Duração máxima: 720 minutos.'),
  before: z.coerce.number().int().min(0, 'Intervalo anterior: de 0 a 240 min.').max(240, 'Intervalo anterior: de 0 a 240 min.'),
  after: z.coerce.number().int().min(0, 'Intervalo posterior: de 0 a 240 min.').max(240, 'Intervalo posterior: de 0 a 240 min.'),
  price: z.string().trim().max(14).optional(),
  active: checkbox,
  is_public: checkbox,
});

export async function saveService(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  const values = formObject(fd);
  const p = parse(serviceSchema, values, values);
  if (!p.ok) return p.state;
  const cents = priceToCents(p.data.price);
  if (cents === 'invalid') return fail('Revise os campos destacados.', { price: ['Preço inválido (ex.: 80,00).'] }, values);
  return guarded('manager', 'saveService', async ({ ctx, org }) => {
    const d = p.data;
    const { data, error } = await ctx.supabase.rpc('ag_save_service', { p_org: org, p_id: d.id ?? null, p_name: d.name, p_description: d.description || null, p_duration: d.duration, p_buf_before: d.before, p_buf_after: d.after, p_price_cents: cents, p_active: d.active ?? false, p_public: d.is_public ?? false });
    if (error) return fail(dbMessage(error), undefined, values);
    bust('/servicos', '/profissionais', '/agenda', '/agendamentos');
    return { ...succeed(d.id ? 'Serviço atualizado. Reservas já feitas mantêm a duração, os intervalos e o preço do momento da reserva.' : 'Serviço cadastrado.'), id: data as string };
  });
}

const customerSchema = z.object({
  id: optUuid.optional(),
  name: z.string().trim().min(2, 'Informe o nome (mínimo de 2 letras).').max(120),
  email: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(30).optional(),
});

export async function saveCustomer(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  const values = formObject(fd);
  const p = parse(customerSchema, values, values);
  if (!p.ok) return p.state;
  return guarded('manager', 'saveCustomer', async ({ ctx, org }) => {
    const d = p.data;
    const { data, error } = await ctx.supabase.rpc('ag_save_customer', { p_org: org, p_id: d.id ?? null, p_name: d.name, p_email: d.email || null, p_phone: d.phone || null });
    if (error) return fail(dbMessage(error), undefined, values);
    bust('/clientes', '/agendamentos', '/agenda');
    return { ...succeed(d.id ? 'Cliente atualizado.' : 'Cliente cadastrado.'), id: data as string, redirectTo: d.id ? undefined : `/clientes/${data as string}` };
  });
}

export async function anonymizeCustomer(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  const id = z.string().uuid().safeParse(fd.get('id'));
  if (!id.success) return fail('Cliente inválido.');
  if (fd.get('confirm') !== 'ANONIMIZAR') return fail('Digite ANONIMIZAR para confirmar.', { confirm: ['Digite ANONIMIZAR para confirmar.'] });
  return guarded('owner', 'anonymizeCustomer', async ({ ctx, org }) => {
    const { error } = await ctx.supabase.rpc('ag_anonymize_customer', { p_org: org, p_id: id.data });
    if (error) return fail(dbMessage(error));
    bust('/clientes', '/agendamentos', '/agenda');
    return { ...succeed('Dados pessoais do cliente anonimizados. O histórico estatístico foi mantido.'), redirectTo: '/clientes' };
  });
}
