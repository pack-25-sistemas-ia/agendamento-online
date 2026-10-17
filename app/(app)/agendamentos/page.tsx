import type { Metadata } from 'next';
import Link from 'next/link';
import { DateTimeLocal, FilterForm, FInput, FSelect, Pagination, StatusPill, TD, TH, TableShell } from '@/components/ag/bits';
import { PageHeader } from '@/components/ui/primitives';
import { APPT_SELECT, listProfessionals, type ApptRow } from '@/lib/scheduling/data';
import { pageCtx } from '@/lib/scheduling/page';
import { PAGE_SIZE, isIsoDate, one, pageFrom, safeSearch, uuidOrNull, type SearchParams } from '@/lib/scheduling/query';
import { SOURCE_LABEL, STATUSES, STATUS_LABEL, isStatus } from '@/lib/scheduling/status';
import { addDays, formatDateBR, localToInstant } from '@/lib/scheduling/time';

export const metadata: Metadata = { title: 'Agendamentos' };

export default async function AppointmentsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const c = await pageCtx(['owner', 'manager', 'professional']);
  const sp = await searchParams;
  const from = isIsoDate(one(sp.from)) ? one(sp.from)! : addDays(c.today, -7);
  const to = isIsoDate(one(sp.to)) && one(sp.to)! >= from ? one(sp.to)! : addDays(c.today, 30);
  const status = isStatus(one(sp.status)) ? one(sp.status)! : null;
  const source = one(sp.source) === 'admin' || one(sp.source) === 'public' ? one(sp.source)! : null;
  const q = safeSearch(one(sp.q));
  const page = pageFrom(one(sp.page));
  const profs = c.isManager ? await listProfessionals(c.ctx, c.org) : [];
  const prof = c.isManager ? uuidOrNull(one(sp.prof)) : null;

  let query = c.ctx.supabase.from('appointments').select(q ? APPT_SELECT.replace('customers(', 'customers!inner(') : APPT_SELECT, { count: 'exact' }).eq('organization_id', c.org)
    .gte('starts_at', new Date(localToInstant(from, '00:00', c.tz)).toISOString()).lt('starts_at', new Date(localToInstant(addDays(to, 1), '00:00', c.tz)).toISOString())
    .order('starts_at', { ascending: false }).range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (status) query = query.eq('status', status);
  if (source) query = query.eq('source', source);
  if (prof) query = query.eq('professional_id', prof);
  if (q) query = query.ilike('customers.name', `%${q}%`);
  const { data, count } = await query;
  const rows = (data ?? []) as unknown as ApptRow[];
  const exportQs = new URLSearchParams({ from, to, ...(status ? { status } : {}), ...(source ? { source } : {}), ...(prof ? { prof } : {}), ...(q ? { q } : {}) }).toString();

  return (
    <>
      <PageHeader title="Agendamentos" description={`De ${formatDateBR(from)} a ${formatDateBR(to)} · fuso ${c.tz}.`}>
        <div className="flex flex-wrap gap-2">
          {c.isManager ? <Link href={`/api/exportar/agendamentos?${exportQs}`} className="inline-flex min-h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5">Exportar CSV</Link> : null}
          {c.isManager ? <Link href="/agendamentos/novo" className="inline-flex min-h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90">Novo agendamento</Link> : null}
        </div>
      </PageHeader>
      <FilterForm clear="/agendamentos">
        <FInput name="from" label="De" type="date" sp={{ ...sp, from }} />
        <FInput name="to" label="Até" type="date" sp={{ ...sp, to }} />
        <FInput name="q" label="Cliente" sp={sp} placeholder="Nome do cliente" />
        {c.isManager ? <FSelect name="prof" label="Profissional" sp={sp} opts={profs.map((p) => ({ value: p.id, label: p.name }))} /> : null}
        <FSelect name="status" label="Situação" sp={sp} opts={STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))} />
        <FSelect name="source" label="Origem" sp={sp} opts={[{ value: 'admin', label: SOURCE_LABEL.admin! }, { value: 'public', label: SOURCE_LABEL.public! }]} />
      </FilterForm>
      <TableShell caption="Agendamentos" empty={rows.length === 0} emptyText="Nenhum agendamento encontrado com estes filtros.">
        <thead><tr><th className={TH}>Quando</th><th className={TH}>Cliente</th><th className={TH}>Serviço</th><th className={TH}>Profissional</th><th className={TH}>Situação</th><th className={TH}>Origem</th><th className={TH}><span className="sr-only">Ações</span></th></tr></thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id} className="border-t border-border">
              <td className={TD}><DateTimeLocal value={a.starts_at} tz={c.tz} /></td>
              <td className={TD}>{a.customers?.name ?? '—'}</td>
              <td className={TD}>{a.service_name_snapshot} <span className="text-xs text-muted">({a.duration_minutes_snapshot} min)</span></td>
              <td className={TD}>{a.professionals?.name ?? '—'}</td>
              <td className={TD}><StatusPill status={a.status} /></td>
              <td className={TD}>{SOURCE_LABEL[a.source] ?? a.source}</td>
              <td className={TD}><Link className="underline underline-offset-2" href={`/agendamentos/${a.id}`}>Abrir</Link></td>
            </tr>
          ))}
        </tbody>
      </TableShell>
      <Pagination base="/agendamentos" sp={sp} page={page} total={count ?? 0} />
    </>
  );
}
