import type { Metadata } from 'next';
import Link from 'next/link';
import { AgendaGrid, type GridCol, type GridItem } from '@/components/ag/agenda-grid';
import { DateTimeLocal, FSelect, StatusPill } from '@/components/ag/bits';
import { EmptyState, PageHeader } from '@/components/ui/primitives';
import { APPT_SELECT, availabilityOf, blocksOf, listProfessionals, type ApptRow } from '@/lib/scheduling/data';
import { pageCtx } from '@/lib/scheduling/page';
import { isIsoDate, one, uuidOrNull, withParams, type SearchParams } from '@/lib/scheduling/query';
import { windowsFor } from '@/lib/scheduling/slots';
import { STATUSES, STATUS_LABEL, isStatus } from '@/lib/scheduling/status';
import { addDays, dateRange, formatDateBR, formatDateLong, instantToLocal, localToInstant, weekStart, weekdayShort, weekdayOf } from '@/lib/scheduling/time';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Agenda' };

const VIEWS = [['day', 'Dia'], ['week', 'Semana'], ['list', 'Lista']] as const;
type View = (typeof VIEWS)[number][0];

export default async function AgendaPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const c = await pageCtx(['owner', 'manager', 'professional']);
  const sp = await searchParams;
  const view: View = (VIEWS.map((v) => v[0]) as string[]).includes(one(sp.view) ?? '') ? (one(sp.view) as View) : 'day';
  const date = isIsoDate(one(sp.date)) ? one(sp.date)! : c.today;
  const statusFilter = isStatus(one(sp.status)) ? one(sp.status)! : null;

  const all = await listProfessionals(c.ctx, c.org, true);
  const profFilter = c.isManager ? uuidOrNull(one(sp.prof)) : c.professionalId;
  let shown = profFilter ? all.filter((p) => p.id === profFilter) : all;
  if (view === 'week' && shown.length > 1) shown = shown.slice(0, 1); // a semana mostra um profissional por vez
  const truncated = view === 'day' && shown.length > 8;
  if (truncated) shown = shown.slice(0, 8);

  const rangeFrom = view === 'week' ? weekStart(date) : date;
  const rangeTo = view === 'week' ? addDays(rangeFrom, 6) : view === 'list' ? addDays(date, 13) : date;
  const fromIso = new Date(localToInstant(rangeFrom, '00:00', c.tz)).toISOString();
  const toIso = new Date(localToInstant(addDays(rangeTo, 1), '00:00', c.tz)).toISOString();
  const ids = shown.map((p) => p.id);

  let q = c.ctx.supabase.from('appointments').select(APPT_SELECT).eq('organization_id', c.org).gte('starts_at', fromIso).lt('starts_at', toIso).order('starts_at').limit(600);
  if (ids.length) q = q.in('professional_id', ids);
  if (statusFilter) q = q.eq('status', statusFilter); else if (view !== 'list') q = q.neq('status', 'cancelled');
  const [{ data: apptData }, blocks, av] = await Promise.all([q, blocksOf(c.ctx, c.org, ids.length ? ids : null, fromIso, toIso), availabilityOf(c.ctx, c.org, ids, rangeFrom, rangeTo)]);
  const appts = (apptData ?? []) as unknown as ApptRow[];

  const dayStartMs = (d: string) => localToInstant(d, '00:00', c.tz);
  const minOf = (ms: number, d: string) => Math.round((ms - dayStartMs(d)) / 60_000);
  const itemsFor = (d: string, profId: string | null): GridItem[] => {
    const s = dayStartMs(d); const e = localToInstant(addDays(d, 1), '00:00', c.tz);
    const out: GridItem[] = [];
    for (const a of appts) {
      if ((profId && a.professional_id !== profId) || Date.parse(a.starts_at) < s || Date.parse(a.starts_at) >= e) continue;
      out.push({ id: a.id, kind: 'appt', startMin: minOf(Date.parse(a.starts_at), d), endMin: minOf(Date.parse(a.ends_at), d), title: a.customers?.name ?? 'Cliente', sub: `${a.service_name_snapshot}${profId ? '' : ''}`, status: a.status, href: `/agendamentos/${a.id}`, color: a.professionals?.display_color ?? '' });
    }
    for (const b of blocks) {
      if ((profId && b.professional_id !== profId) || Date.parse(b.occupied_end_at) <= s || Date.parse(b.occupied_start_at) >= e) continue;
      out.push({ id: b.id, kind: 'block', startMin: Math.max(0, minOf(Date.parse(b.occupied_start_at), d)), endMin: Math.min(1440, minOf(Date.parse(b.occupied_end_at), d)), title: 'Bloqueado', sub: c.isManager ? (b.block_reason ?? 'Sem motivo informado') : 'Indisponível', color: '' });
    }
    return out;
  };
  const winOf = (profId: string, d: string) => windowsFor(d, av.get(profId) ?? { rules: [], overrides: [] }, c.tz).map((w) => ({ startMin: minOf(w.startMs, d), endMin: minOf(w.endMs, d) }));

  let cols: GridCol[] = [];
  if (view === 'day') {
    cols = shown.map((p) => ({ key: p.id, title: p.name, subtitle: formatDateLong(date), windows: winOf(p.id, date), items: itemsFor(date, p.id).map((i) => ({ ...i, color: p.display_color })) }));
  } else if (view === 'week' && shown[0]) {
    const p = shown[0];
    cols = dateRange(rangeFrom, rangeTo).map((d) => ({ key: d, title: `${weekdayShort(weekdayOf(d))} ${formatDateBR(d).slice(0, 5)}`, subtitle: p.name, windows: winOf(p.id, d), items: itemsFor(d, p.id).map((i) => ({ ...i, color: p.display_color })) }));
  }
  const allMins = cols.flatMap((col) => [...col.windows.flatMap((w) => [w.startMin, w.endMin]), ...col.items.flatMap((i) => [i.startMin, i.endMin])]);
  const startMin = allMins.length ? Math.max(0, Math.floor(Math.min(...allMins) / 60) * 60) : 8 * 60;
  const endMin = allMins.length ? Math.min(1440, Math.ceil(Math.max(...allMins) / 60) * 60) : 19 * 60;

  const step = view === 'week' ? 7 : 1;
  const nav = (changes: Record<string, string | null>) => withParams('/agenda', sp, changes);
  const tab = 'inline-flex min-h-10 items-center rounded-md border px-3 text-sm font-medium';
  const byDay = new Map<string, ApptRow[]>();
  for (const a of appts) { const d = instantToLocal(Date.parse(a.starts_at), c.tz).date; byDay.set(d, [...(byDay.get(d) ?? []), a]); }
  const listDays = view === 'list' ? dateRange(rangeFrom, rangeTo) : view === 'week' ? dateRange(rangeFrom, rangeTo) : [date];

  return (
    <>
      <PageHeader title="Agenda" description={`${view === 'week' ? `Semana de ${formatDateBR(rangeFrom)} a ${formatDateBR(rangeTo)}` : view === 'list' ? `Próximos 14 dias a partir de ${formatDateBR(date)}` : formatDateLong(date)} · fuso ${c.tz}`}>
        {c.isManager ? <Link href={`/agendamentos/novo?date=${date}${profFilter ? `&prof=${profFilter}` : ''}`} className="inline-flex min-h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90">Novo agendamento</Link> : null}
      </PageHeader>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <nav aria-label="Visualização" className="flex gap-1">
          {VIEWS.map(([k, label]) => <Link key={k} href={nav({ view: k })} aria-current={k === view ? 'page' : undefined} className={cn(tab, k === view ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-black/5 dark:hover:bg-white/5')}>{label}</Link>)}
        </nav>
        <nav aria-label="Navegar por data" className="flex gap-1">
          <Link href={nav({ date: addDays(date, -step) })} className={cn(tab, 'border-border hover:bg-black/5 dark:hover:bg-white/5')} aria-label="Anterior">‹</Link>
          <Link href={nav({ date: null })} className={cn(tab, 'border-border hover:bg-black/5 dark:hover:bg-white/5')}>Hoje</Link>
          <Link href={nav({ date: addDays(date, step) })} className={cn(tab, 'border-border hover:bg-black/5 dark:hover:bg-white/5')} aria-label="Próximo">›</Link>
        </nav>
        <form method="get" className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="view" value={view} />
          <label className="flex flex-col gap-1 text-xs font-medium text-muted">Data<input type="date" name="date" defaultValue={date} className="min-h-10 rounded-md border border-border bg-card px-2 text-sm font-normal text-foreground" /></label>
          {c.isManager ? <FSelect name="prof" label="Profissional" sp={sp} opts={all.map((p) => ({ value: p.id, label: p.name }))} /> : null}
          <FSelect name="status" label="Situação" sp={sp} opts={STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))} />
          <button type="submit" className="inline-flex min-h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5">Aplicar</button>
        </form>
      </div>
      {truncated ? <p className="mb-3 text-xs text-muted">Mostrando os 8 primeiros profissionais. Use o filtro de profissional para ver os demais.</p> : null}

      {all.length === 0 ? <EmptyState title="Nenhum profissional cadastrado" description="Cadastre profissionais, serviços e horários para começar a agendar."><Link className="text-sm underline" href="/profissionais">Ir para Profissionais</Link></EmptyState> : (
        <>
          {view !== 'list' && cols.length > 0 ? <AgendaGrid cols={cols} startMin={startMin} endMin={endMin} label={view === 'day' ? 'Agenda do dia' : 'Agenda da semana'} /> : null}
          {/* Lista (e visão única no celular): por dia, em ordem de horário */}
          <div className={cn(view === 'list' ? '' : 'md:hidden', 'space-y-5')}>
            {listDays.map((d) => {
              const rows = byDay.get(d) ?? [];
              const dayBlocks = blocks.filter((b) => Date.parse(b.occupied_start_at) < localToInstant(addDays(d, 1), '00:00', c.tz) && Date.parse(b.occupied_end_at) > dayStartMs(d));
              if (view === 'list' && rows.length === 0 && dayBlocks.length === 0) return null;
              return (
                <section key={d} aria-labelledby={`dia-${d}`}>
                  <h2 id={`dia-${d}`} className="mb-2 text-sm font-semibold capitalize">{formatDateLong(d)}</h2>
                  {rows.length === 0 && dayBlocks.length === 0 ? <p className="rounded-lg border border-dashed border-border px-4 py-4 text-sm text-muted">Sem atendimentos neste dia.</p> : (
                    <ul className="divide-y divide-border rounded-lg border border-border bg-card">
                      {rows.map((a) => (
                        <li key={a.id}>
                          <Link href={`/agendamentos/${a.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-black/5 dark:hover:bg-white/5">
                            <span className="w-20 shrink-0 text-sm font-medium tabular-nums"><DateTimeLocal value={a.starts_at} tz={c.tz} /></span>
                            <span className="min-w-0 flex-1 text-sm"><span className="block truncate font-medium">{a.customers?.name ?? 'Cliente'}</span><span className="block truncate text-xs text-muted">{a.service_name_snapshot} · {a.professionals?.name}</span></span>
                            <StatusPill status={a.status} />
                          </Link>
                        </li>
                      ))}
                      {dayBlocks.map((b) => (
                        <li key={b.id} className="flex flex-wrap items-center gap-3 bg-black/[0.04] px-4 py-3 text-sm dark:bg-white/[0.04]">
                          <span className="font-medium">Bloqueado</span><span className="text-muted">{c.isManager ? (b.block_reason ?? 'Sem motivo informado') : 'Indisponível'}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
            {view === 'list' && appts.length === 0 && blocks.length === 0 ? <EmptyState title="Nada agendado neste período" description="Altere a data ou os filtros." /> : null}
          </div>
        </>
      )}
    </>
  );
}
