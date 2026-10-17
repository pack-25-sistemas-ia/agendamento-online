import 'server-only';
import { headers } from 'next/headers';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getPublicEnv } from '@/lib/env';
import { rateLimit, type RateLimitRule } from '@/lib/security/rate-limit';
import { clientKey } from './token';

/** Cliente SEM sessão (papel anon). Só alcança as operações ag_public_* — nunca tabelas. Nenhuma chave privilegiada existe neste sistema. */
export function publicClient(): SupabaseClient {
  const env = getPublicEnv();
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

/** IP do solicitante (cabeçalho do proxy de hospedagem). Usado só para limite de abuso e em forma de hash. */
export async function requesterId(): Promise<{ ip: string; key: string }> {
  const h = await headers();
  const ip = (h.get('x-forwarded-for') ?? h.get('x-real-ip') ?? 'desconhecido').split(',')[0]!.trim().slice(0, 64) || 'desconhecido';
  return { ip, key: clientKey(ip) };
}

export const PUBLIC_LIMITS = {
  slots: { limit: 90, windowMs: 60_000 },
  book: { limit: 12, windowMs: 10 * 60_000 },
  token: { limit: 40, windowMs: 10 * 60_000 },
} satisfies Record<string, RateLimitRule>;

export function limited(scope: keyof typeof PUBLIC_LIMITS, ip: string): { allowed: boolean; retryAfterSeconds: number } {
  return rateLimit(`ag-pub:${scope}:${ip}`, PUBLIC_LIMITS[scope]);
}
