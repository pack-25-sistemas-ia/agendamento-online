import 'server-only';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { requireContext, type Context } from '@/lib/auth/session';
import { nowMs } from '@/lib/time';
import { instantToLocal } from './time';
import type { Profile } from './status';

export type SchedulingSettings = {
  timezone: string; public_booking_enabled: boolean; public_display_name: string | null; logo_path: string | null; primary_color: string; public_description: string | null;
  public_contact: string | null; minimum_notice_minutes: number; booking_horizon_days: number; slot_step_minutes: number; customer_cancellation_notice_minutes: number;
  customer_rescheduling_notice_minutes: number; booking_policy_text: string | null;
};
export const DEFAULT_SETTINGS: SchedulingSettings = {
  timezone: 'America/Sao_Paulo', public_booking_enabled: false, public_display_name: null, logo_path: null, primary_color: '#1d4ed8', public_description: null, public_contact: null,
  minimum_notice_minutes: 120, booking_horizon_days: 60, slot_step_minutes: 30, customer_cancellation_notice_minutes: 1440, customer_rescheduling_notice_minutes: 1440, booking_policy_text: null,
};

export type Access = { profile: Profile | null; professionalId: string | null };

/** Perfil e profissional vinculado do usuário na empresa ativa (uma ida ao banco por requisição). */
export const loadAccess = cache(async (org: string): Promise<Access> => {
  const ctx = await requireContext();
  const { data } = await ctx.supabase.rpc('ag_my_context', { p_org: org });
  const d = (data ?? {}) as { profile?: Profile | null; professional_id?: string | null };
  return { profile: d.profile ?? null, professionalId: d.professional_id ?? null };
});

const MANAGERS: readonly Profile[] = ['owner', 'manager'];
export const NAV_ACCESS = { all: ['owner', 'manager', 'professional'], managers: MANAGERS, owner: ['owner'] } as const satisfies Record<string, readonly Profile[]>;

/** Contexto comum das páginas: sessão (já com MFA/papel), perfil, políticas, fuso e «hoje» no fuso da empresa. */
export async function pageCtx(allow?: readonly Profile[]) {
  const ctx = await requireContext();
  const org = ctx.membership.organization_id;
  const access = await loadAccess(org);
  if (allow && (!access.profile || !allow.includes(access.profile))) notFound();
  const { data } = await ctx.supabase.from('scheduling_settings').select('timezone, public_booking_enabled, public_display_name, logo_path, primary_color, public_description, public_contact, minimum_notice_minutes, booking_horizon_days, slot_step_minutes, customer_cancellation_notice_minutes, customer_rescheduling_notice_minutes, booking_policy_text').eq('organization_id', org).maybeSingle();
  const settings: SchedulingSettings = (data as SchedulingSettings | null) ?? DEFAULT_SETTINGS;
  const now = nowMs();
  const today = instantToLocal(now, settings.timezone).date;
  const isManager = access.profile === 'owner' || access.profile === 'manager';
  return { ctx, org, settings, tz: settings.timezone, today, now, profile: access.profile, professionalId: access.professionalId, isManager, isOwner: access.profile === 'owner' };
}
export type PageCtx = Awaited<ReturnType<typeof pageCtx>>;
export type { Context };
