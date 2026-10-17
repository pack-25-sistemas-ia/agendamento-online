import 'server-only';
import type { Context } from '@/lib/auth/session';
import type { Availability, Busy } from './slots';

// Leitura (sempre sob RLS, com a sessão do usuário): o banco decide o que cada perfil enxerga.
export type Professional = { id: string; name: string; display_color: string; active: boolean; linked_user_id: string | null; public_bio: string | null };
export type Service = { id: string; name: string; description: string | null; duration_minutes: number; buffer_before_minutes: number; buffer_after_minutes: number; reference_price_cents: number | null; active: boolean; public_booking_enabled: boolean };
export type ApptRow = {
  id: string; starts_at: string; ends_at: string; status: string; source: string; service_name_snapshot: string; duration_minutes_snapshot: number; reference_price_cents_snapshot: number | null; professional_id: string; customer_id: string; service_id: string;
  internal_notes?: string | null; cancellation_reason?: string | null; created_at?: string; schedule_entry_id?: string;
  customers: { name: string; phone: string | null; email: string | null } | null;
  professionals: { name: string; display_color: string } | null;
};
export const APPT_SELECT = 'id, starts_at, ends_at, status, source, service_name_snapshot, duration_minutes_snapshot, reference_price_cents_snapshot, professional_id, customer_id, service_id, internal_notes, cancellation_reason, created_at, schedule_entry_id, customers(name, phone, email), professionals(name, display_color)';

export async function listProfessionals(ctx: Context, org: string, onlyActive = false): Promise<Professional[]> {
  let q = ctx.supabase.from('professionals').select('id, name, display_color, active, linked_user_id, public_bio').eq('organization_id', org).order('name');
  if (onlyActive) q = q.eq('active', true);
  const { data } = await q;
  return (data ?? []) as Professional[];
}
export async function listServices(ctx: Context, org: string, onlyActive = false): Promise<Service[]> {
  let q = ctx.supabase.from('services').select('id, name, description, duration_minutes, buffer_before_minutes, buffer_after_minutes, reference_price_cents, active, public_booking_enabled').eq('organization_id', org).order('name');
  if (onlyActive) q = q.eq('active', true);
  const { data } = await q;
  return (data ?? []) as Service[];
}
/** professional_id → service_id[] */
export async function professionalServiceMap(ctx: Context, org: string): Promise<Map<string, string[]>> {
  const { data } = await ctx.supabase.from('professional_services').select('professional_id, service_id').eq('organization_id', org);
  const m = new Map<string, string[]>();
  for (const r of (data ?? []) as Array<{ professional_id: string; service_id: string }>) m.set(r.professional_id, [...(m.get(r.professional_id) ?? []), r.service_id]);
  return m;
}

/** Disponibilidade (regras + exceções) de vários profissionais, para sombrear o expediente na agenda. */
export async function availabilityOf(ctx: Context, org: string, profIds: string[], fromDate: string, toDate: string): Promise<Map<string, Availability>> {
  const out = new Map<string, Availability>(profIds.map((id) => [id, { rules: [], overrides: [] }]));
  if (profIds.length === 0) return out;
  const [r, o] = await Promise.all([
    ctx.supabase.from('availability_rules').select('professional_id, weekday, local_start_time, local_end_time, active').eq('organization_id', org).in('professional_id', profIds),
    ctx.supabase.from('availability_overrides').select('professional_id, local_date, local_start_time, local_end_time').eq('organization_id', org).in('professional_id', profIds).gte('local_date', fromDate).lte('local_date', toDate),
  ]);
  for (const x of (r.data ?? []) as Array<{ professional_id: string; weekday: number; local_start_time: string; local_end_time: string; active: boolean }>) {
    out.get(x.professional_id)?.rules.push({ weekday: x.weekday, start: x.local_start_time.slice(0, 5), end: x.local_end_time.slice(0, 5), active: x.active });
  }
  for (const x of (o.data ?? []) as Array<{ professional_id: string; local_date: string; local_start_time: string | null; local_end_time: string | null }>) {
    out.get(x.professional_id)?.overrides.push({ date: x.local_date, start: x.local_start_time?.slice(0, 5) ?? null, end: x.local_end_time?.slice(0, 5) ?? null });
  }
  return out;
}

export type BlockRow = { id: string; professional_id: string; occupied_start_at: string; occupied_end_at: string; block_reason: string | null };
export async function blocksOf(ctx: Context, org: string, profIds: string[] | null, fromIso: string, toIso: string): Promise<BlockRow[]> {
  let q = ctx.supabase.from('schedule_entries').select('id, professional_id, occupied_start_at, occupied_end_at, block_reason').eq('organization_id', org).eq('kind', 'block').eq('active', true).lt('occupied_start_at', toIso).gt('occupied_end_at', fromIso).order('occupied_start_at');
  if (profIds) q = q.in('professional_id', profIds);
  const { data } = await q;
  return (data ?? []) as BlockRow[];
}

export const busyOf = (blocks: BlockRow[]): Busy[] => blocks.map((b) => ({ startMs: Date.parse(b.occupied_start_at), endMs: Date.parse(b.occupied_end_at) }));
