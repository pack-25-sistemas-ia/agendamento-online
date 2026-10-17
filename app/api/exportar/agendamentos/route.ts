import { NextResponse, type NextRequest } from 'next/server';
import { resolveContext } from '@/lib/auth/session';
import { rateLimit } from '@/lib/security/rate-limit';
import { toCsv } from '@/lib/scheduling/csv';
import { APPT_SELECT, type ApptRow } from '@/lib/scheduling/data';
import { isIsoDate, safeSearch, uuidOrNull } from '@/lib/scheduling/query';
import { SOURCE_LABEL, STATUS_LABEL, isStatus, type Status } from '@/lib/scheduling/status';
import { addDays, instantToLocal, localToInstant } from '@/lib/scheduling/time';
import { nowMs } from '@/lib/time';

// Exportação CSV dos agendamentos (gestão). Sessão, MFA e perfil são conferidos no servidor; o banco filtra por RLS;
// fórmulas são neutralizadas; a exportação é auditada (somente tipo e quantidade de linhas).
const MAX_ROWS = 10_000;

export async function GET(req: NextRequest) {
  const r = await resolveContext();
  if (r.kind !== 'ok') return new NextResponse(r.kind === 'forbidden' ? 'Sem permissão' : 'Não autenticado', { status: r.kind === 'forbidden' ? 403 : 401 });
  const { supabase, user, membership } = r.ctx;
  const org = membership.organization_id;
  const rl = rateLimit(`ag-export:${user.id}`, { limit: 10, windowMs: 60_000 });
  if (!rl.allowed) return new NextResponse('Muitas exportações. Aguarde um instante.', { status: 429, headers: { 'retry-after': String(rl.retryAfterSeconds) } });
  const { data: ctxData } = await supabase.rpc('ag_my_context', { p_org: org });
  const info = (ctxData ?? {}) as { profile?: string; timezone?: string };
  const tz = info.timezone ?? 'America/Sao_Paulo';
  if (info.profile !== 'owner' && info.profile !== 'manager') return new NextResponse('Sem permissão', { status: 403 });

  const p = req.nextUrl.searchParams;
  const from = isIsoDate(p.get('from') ?? undefined) ? p.get('from')! : addDays(instantToLocal(nowMs(), tz).date, -30);
  const to = isIsoDate(p.get('to') ?? undefined) && p.get('to')! >= from ? p.get('to')! : addDays(from, 60);
  const status = p.get('status');
  const source = p.get('source');
  const prof = uuidOrNull(p.get('prof') ?? undefined);
  const q = safeSearch(p.get('q') ?? undefined);

  let query = supabase.from('appointments').select(q ? APPT_SELECT.replace('customers(', 'customers!inner(') : APPT_SELECT).eq('organization_id', org)
    .gte('starts_at', new Date(localToInstant(from, '00:00', tz)).toISOString()).lt('starts_at', new Date(localToInstant(addDays(to, 1), '00:00', tz)).toISOString()).order('starts_at').limit(MAX_ROWS);
  if (isStatus(status)) query = query.eq('status', status);
  if (source === 'admin' || source === 'public') query = query.eq('source', source);
  if (prof) query = query.eq('professional_id', prof);
  if (q) query = query.ilike('customers.name', `%${q}%`);
  const { data, error } = await query;
  if (error) return new NextResponse('Falha ao exportar', { status: 500 });
  const rows = (data ?? []) as unknown as ApptRow[];

  const csv = toCsv(
    [
      { key: 'date', label: 'Data', kind: 'text' }, { key: 'time', label: 'Início', kind: 'text' }, { key: 'customer', label: 'Cliente', kind: 'text' }, { key: 'phone', label: 'Telefone', kind: 'text' },
      { key: 'email', label: 'E-mail', kind: 'text' }, { key: 'service', label: 'Serviço', kind: 'text' }, { key: 'professional', label: 'Profissional', kind: 'text' },
      { key: 'duration', label: 'Duração (min)', kind: 'int' }, { key: 'status', label: 'Situação', kind: 'text' }, { key: 'source', label: 'Origem', kind: 'text' },
    ],
    rows.map((a) => {
      const l = instantToLocal(Date.parse(a.starts_at), tz);
      return { date: l.date.split('-').reverse().join('/'), time: l.time, customer: a.customers?.name, phone: a.customers?.phone, email: a.customers?.email, service: a.service_name_snapshot,
        professional: a.professionals?.name, duration: a.duration_minutes_snapshot, status: STATUS_LABEL[a.status as Status] ?? a.status, source: SOURCE_LABEL[a.source] ?? a.source };
    }),
  );
  await supabase.rpc('ag_log_export', { p_org: org, p_kind: 'agendamentos', p_rows: rows.length });
  return new NextResponse(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="agendamentos-${from}-a-${to}.csv"`, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } });
}
