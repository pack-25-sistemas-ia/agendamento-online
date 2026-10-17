'use server';

import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { fail, succeed, type ActionState } from '@/lib/actions/result';
import { isValidTimeZone } from '../time';
import { bust, bustAll, dbMessage, formObject, guarded, parse, type SaveResult } from '../action-kit';

const checkbox = z.union([z.literal('on'), z.literal('')]).optional().transform((v) => v === 'on');
const int = (min: number, max: number, label: string) => z.coerce.number({ message: `${label}: informe um número.` }).int(`${label}: use um número inteiro.`).min(min, `${label}: mínimo ${min}.`).max(max, `${label}: máximo ${max}.`);

/** Regras de agendamento (proprietário). */
const rulesSchema = z.object({
  timezone: z.string().trim().min(3).max(60).refine(isValidTimeZone, 'Fuso horário inválido (ex.: America/Sao_Paulo).'),
  minimum_notice_minutes: int(0, 43200, 'Antecedência mínima'),
  booking_horizon_days: int(1, 365, 'Horizonte'),
  slot_step_minutes: z.coerce.number().refine((n) => [5, 10, 15, 20, 30, 60].includes(n), 'O passo deve ser 5, 10, 15, 20, 30 ou 60 minutos.'),
  customer_cancellation_notice_minutes: int(0, 43200, 'Prazo de cancelamento'),
  customer_rescheduling_notice_minutes: int(0, 43200, 'Prazo de reagendamento'),
});

export async function saveRules(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  const values = formObject(fd);
  const p = parse(rulesSchema, values, values);
  if (!p.ok) return p.state;
  return guarded('owner', 'saveRules', async ({ ctx, org }) => {
    const { error } = await ctx.supabase.rpc('ag_save_settings', { p_org: org, p: p.data });
    if (error) return fail(dbMessage(error), undefined, values);
    bustAll();
    return succeed('Configurações salvas.');
  });
}

/** Identidade e textos da página pública (proprietário). */
const publicPageSchema = z.object({
  public_booking_enabled: checkbox,
  public_display_name: z.string().trim().max(80, 'Nome longo demais (máx. 80).').optional(),
  public_description: z.string().trim().max(500, 'Descrição longa demais (máx. 500).').optional(),
  public_contact: z.string().trim().max(200, 'Contato longo demais (máx. 200).').optional(),
  primary_color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Cor inválida (use #RRGGBB).'),
  booking_policy_text: z.string().trim().max(1000, 'Política longa demais (máx. 1000).').optional(),
});

export async function savePublicPage(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  const values = formObject(fd);
  const p = parse(publicPageSchema, values, values);
  if (!p.ok) return p.state;
  if (p.data.public_display_name && p.data.public_display_name.length < 2) return fail('Revise os campos destacados.', { public_display_name: ['Nome público: mínimo de 2 caracteres.'] }, values);
  return guarded('owner', 'savePublicPage', async ({ ctx, org }) => {
    const d = p.data;
    const { error } = await ctx.supabase.rpc('ag_save_settings', { p_org: org, p: {
      public_booking_enabled: d.public_booking_enabled ?? false, public_display_name: d.public_display_name || null, public_description: d.public_description || null,
      public_contact: d.public_contact || null, primary_color: d.primary_color, booking_policy_text: d.booking_policy_text || null } });
    if (error) return fail(dbMessage(error), undefined, values);
    bust('/pagina-de-reservas', '/dashboard');
    return succeed(d.public_booking_enabled ? 'Página de reservas salva e ATIVA.' : 'Página de reservas salva (desativada: ninguém consegue reservar).');
  });
}

// ---- logotipo: só imagens raster pequenas, tipo conferido pelos BYTES (não pelo nome nem pelo Content-Type enviado)
const MAX_LOGO = 512 * 1024;
function sniff(b: Uint8Array): { ext: 'png' | 'jpg' | 'webp'; mime: string } | null {
  if (b.length > 12 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { ext: 'png', mime: 'image/png' };
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return { ext: 'webp', mime: 'image/webp' };
  return null;
}

export async function uploadLogo(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  const file = fd.get('logo');
  if (!(file instanceof File) || file.size === 0) return fail('Escolha uma imagem PNG, JPG ou WebP.', { logo: ['Escolha uma imagem.'] });
  if (file.size > MAX_LOGO) return fail('A imagem deve ter no máximo 512 KB.', { logo: ['Imagem grande demais (máx. 512 KB).'] });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniff(bytes);
  if (!kind) return fail('Formato não aceito. Use PNG, JPG ou WebP.', { logo: ['Formato não aceito (use PNG, JPG ou WebP).'] });
  return guarded('owner', 'uploadLogo', async ({ ctx, org }) => {
    const { data: cur } = await ctx.supabase.from('scheduling_settings').select('logo_path').eq('organization_id', org).maybeSingle();
    const path = `${org}/logo-${randomBytes(8).toString('hex')}.${kind.ext}`;
    const up = await ctx.supabase.storage.from('ag-logos').upload(path, bytes, { contentType: kind.mime, upsert: false });
    if (up.error) return fail('Não foi possível enviar o logotipo. Tente novamente.');
    const { error } = await ctx.supabase.rpc('ag_set_logo', { p_org: org, p_path: path });
    if (error) return fail(dbMessage(error));
    const old = (cur as { logo_path: string | null } | null)?.logo_path;
    if (old) await ctx.supabase.storage.from('ag-logos').remove([old]);
    bust('/pagina-de-reservas');
    return succeed('Logotipo atualizado.');
  });
}

export async function removeLogo(): Promise<SaveResult> {
  return guarded('owner', 'removeLogo', async ({ ctx, org }) => {
    const { data: cur } = await ctx.supabase.from('scheduling_settings').select('logo_path').eq('organization_id', org).maybeSingle();
    const { error } = await ctx.supabase.rpc('ag_set_logo', { p_org: org, p_path: null });
    if (error) return fail(dbMessage(error));
    const old = (cur as { logo_path: string | null } | null)?.logo_path;
    if (old) await ctx.supabase.storage.from('ag-logos').remove([old]);
    bust('/pagina-de-reservas');
    return succeed('Logotipo removido.');
  });
}
