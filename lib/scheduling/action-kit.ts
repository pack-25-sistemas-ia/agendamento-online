import 'server-only';
import { revalidatePath } from 'next/cache';
import type { ZodType } from 'zod';
import { actionContext, type Context } from '@/lib/auth/session';
import { fail, fieldErrorsFrom, messageForDbError, type ActionState } from '@/lib/actions/result';
import { logEvent } from '@/lib/log';
import { rateLimit } from '@/lib/security/rate-limit';
import { loadAccess, type Access } from './page';
import type { Profile } from './status';

/** Níveis (o banco reaplica o mesmo critério dentro de cada função ag_*). */
export const LEVELS = {
  staff: ['owner', 'manager', 'professional'],
  manager: ['owner', 'manager'],
  owner: ['owner'],
} as const satisfies Record<string, readonly Profile[]>;
export type Level = keyof typeof LEVELS;

/** As mensagens que escrevemos no banco (funções ag_*) são úteis ao usuário; erros nativos viram mensagem genérica. */
export function dbMessage(error: { code?: string; message?: string }, duplicate?: string): string {
  if (error.code === '23505' && duplicate) return duplicate;
  if (error.code === '23503') return 'Este registro está em uso ou referencia algo inexistente.';
  const msg = error.message ?? '';
  const own = ['23514', '22023', '55000', '54000', '42501', '23505', 'P0002', '23P01'];
  if (own.includes(error.code ?? '') && msg && msg.length <= 300 && !/violat|constraint|relation|column|violação|restrição|permission denied|duplicate key|uniq|_idx|_fk|_check|_excl/i.test(msg)) {
    return msg.charAt(0).toUpperCase() + msg.slice(1) + (/[.!?]$/.test(msg) ? '' : '.');
  }
  if (error.code === '42501') return 'Você não tem permissão para esta ação.';
  if (error.code === '23P01') return 'Esse horário acabou de ser reservado. Escolha outro horário.';
  if (error.code === '23505') return 'Já existe um registro com estes dados.';
  return messageForDbError(error);
}

export function formObject(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === 'string') out[k] = v;
  return out;
}

export function parse<T>(schema: ZodType<T>, data: unknown, values?: Record<string, string>): { ok: true; data: T } | { ok: false; state: ActionState } {
  const r = schema.safeParse(data);
  if (r.success) return { ok: true, data: r.data };
  const first = r.error.issues[0]?.message;
  return { ok: false, state: fail(first && r.error.issues.length === 1 && !r.error.issues[0]?.path.length ? first : 'Revise os campos destacados.', fieldErrorsFrom(r.error), values) };
}

export type ActionCtx = { ctx: Context; org: string; access: Access };

/** Executa uma ação com sessão, MFA, perfil mínimo e limite de taxa; o banco autoriza de novo pelo auth.uid(). */
export async function guarded(level: Level, name: string, fn: (a: ActionCtx) => Promise<ActionState>): Promise<ActionState> {
  const a = await actionContext();
  if ('error' in a) return a.error;
  const org = a.ctx.membership.organization_id;
  const access = await loadAccess(org);
  if (!access.profile || !(LEVELS[level] as readonly Profile[]).includes(access.profile)) return fail('Você não tem permissão para esta ação.');
  const rl = rateLimit(`ag:${a.ctx.user.id}`, { limit: 240, windowMs: 60_000 });
  if (!rl.allowed) return fail(`Muitas operações em pouco tempo. Aguarde ${rl.retryAfterSeconds}s e tente de novo.`);
  try {
    return await fn({ ctx: a.ctx, org, access });
  } catch (e) {
    logEvent('error', 'ag_action_failed', { action: name, name: e instanceof Error ? e.name : 'unknown' });
    return fail('Não foi possível concluir a operação. Tente novamente.');
  }
}

export const bust = (...paths: string[]) => paths.forEach((p) => revalidatePath(p));
export const bustAll = () => revalidatePath('/', 'layout');

export type SaveResult = ActionState & { id?: string; redirectTo?: string };
