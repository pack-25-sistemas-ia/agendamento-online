import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, EmptyState, PageHeader } from '@/components/ui/primitives';
import { DateTimeLocal, FilterForm, FInput, FSelect, Kpi, Section, StatusPill, TD, TH, TableShell } from '@/components/ag/bits';
import { listProfessionals } from '@/lib/scheduling/data';
import { pageCtx } from '@/lib/scheduling/page';
import { isIsoDate, one, uuidOrNull, type SearchParams } from '@/lib/scheduling/query';
import { STATUS_LABEL, type Status } from '@/lib/scheduling/status';
import { addDays, formatDateBR } from '@/lib/scheduling/time';

export const metadata: Metadata = { title: 'Painel de agendamentos' };

type Dash = {
  today_count: number; pending_confirmation: number; completed: number; no_show: number; cancelled: number; no_show_rate: number | null;
  upcoming: Array<{ id: string; starts_at: string; status: string; customer: string; service: string; professional: string }>;
  by_service: Array<{ name: string; count: number }>; by_professional: Array<{ name: string; count: number }>; by_status: Record<string, number>;
};

function monthBounds(today: string): { from: string; to: string } {
  const first = `${today.slice(0, 7)}-01`;
  const next = new Date(Date.UTC(Number(first.slice(0, 4)), Number(first.slice(5, 7)), 1)).toISOString().slice(0, 10);
  return { from: first, to: addDays(next, -1) };
}

function Bars({ rows, label }: { rows: Array<{ name: string; count: number }>; label: string }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  if (rows.length === 0) return <p className="text-sm text-muted">Sem atendimentos no período.</p>;
  return (
    <ul className="space-y-2" aria-label={label}>
      {rows.map((r) => (
        <li key={r.name} className="grid grid-cols-[minmax(0,1fr)_3rem] items-center gap-3 text-sm">
          <span className="min-w-0">
            <span className="block truncate">{r.name}</span>
            <progress className="mt-1 h-2 w-full accent-[var(--color-primary,#1d4ed8)]" value={r.count} max={max} aria-label={`${r.name}: ${r.count}`} />
          </span>
          <span className="text-right tabular-nums font-medium">{r.count}</span>
        </li>
      ))}
    </ul>
  );
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const c = await pageCtx();
  if (!c.profile) {
    return (
      <EmptyState title="Seu usuário ainda não tem acesso à agenda" description="Peça ao proprietário da empresa para vincular você a um profissional (Profissionais) ou ajustar seu papel em Pessoas e acessos.">
        <Link className="text-sm underline underline-offset-2" href="/members">Ver pessoas e acessos</Link>
      </EmptyState>
    );
  }
  const sp = await searchParams;
  const def = monthBounds(c.today);
  const from = isIsoDate(one(sp.from)) ? one(sp.from)! : def.from;
  const to = isIsoDate(one(sp.to)) && one(sp.to)! >= from && one(sp.to)! <= addDays(from, 400) ? one(sp.to)! : def.to;
  const profs = c.isManager ? await listProfessionals(c.ctx, c.org) : [];
  const prof = c.isManager ? uuidOrNull(one(sp.prof)) : null; // profissional já vê só o dele (RLS)
  const { data } = await c.ctx.supabase.rpc('ag_dashboard', { p_org: c.org, p_from: from, p_to: to, p_prof: prof });
  const d = (data ?? null) as Dash | null;
  const setupNeeded = c.isOwner && profs.length === 0;

  return (
    <>
      <PageHeader title="Painel de agendamentos" description={`Período: ${formatDateBR(from)} a ${formatDateBR(to)} · fuso ${c.tz}. Os indicadores contam atendimentos pela data de início, no fuso da empresa.`}>
        {c.isManager ? <Link href="/agendamentos/novo" className="inline-flex min-h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90">Novo agendamento</Link> : null}
      </PageHeader>

      {setupNeeded ? (
        <Card title="Primeiros passos" description="Em poucos minutos sua página de reservas fica no ar.">
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            <li><Link className="underline" href="/profissionais">Cadastre os profissionais</Link> e vincule os serviços que cada um faz.</li>
            <li><Link className="underline" href="/servicos">Cadastre os serviços</Link> (duração, intervalos e preço de referência).</li>
            <li><Link className="underline" href="/disponibilidade">Defina os horários de atendimento</Link>, exceções por data e bloqueios.</li>
            <li><Link className="underline" href="/pagina-de-reservas">Ative a página de reservas</Link>, personalize a marca e divulgue o link.</li>
          </ol>
        </Card>
      ) : null}

      <FilterForm clear="/dashboard">
        <FInput name="from" label="De" type="date" sp={{ ...sp, from }} />
        <FInput name="to" label="Até" type="date" sp={{ ...sp, to }} />
        {c.isManager ? <FSelect name="prof" label="Profissional" sp={sp} opts={profs.map((p) => ({ value: p.id, label: p.name }))} /> : null}
      </FilterForm>

      {!d ? <EmptyState title="Não foi possível carregar os indicadores" description="Tente novamente em instantes." /> : (
        <>
          <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Kpi label="Atendimentos de hoje" value={d.today_count} definition="Não cancelados, com início hoje (fuso da empresa)." />
            <Kpi label="Pendentes de confirmação" value={d.pending_confirmation} tone={d.pending_confirmation > 0 ? 'warning' : 'neutral'} definition="Agendados e futuros que ainda não foram confirmados." />
            <Kpi label="Concluídos no período" value={d.completed} tone="success" definition="Atendimentos marcados como concluídos." />
            <Kpi label="Cancelados no período" value={d.cancelled} definition="Cancelamentos de atendimentos com início no período." />
            <Kpi label="Não comparecimentos" value={d.no_show} tone={d.no_show > 0 ? 'danger' : 'neutral'} definition="Clientes que não compareceram." />
            <Kpi label="Taxa de não comparecimento" value={d.no_show_rate === null ? 'Sem dados' : `${d.no_show_rate.toLocaleString('pt-BR')}%`} definition="Não comparecimentos ÷ (concluídos + não comparecimentos). Sem dados quando não há nenhum dos dois." />
          </div>

          <Section title="Próximos atendimentos" description="Agendados ou confirmados, a partir de agora.">
            <TableShell caption="Próximos atendimentos" empty={d.upcoming.length === 0} emptyText="Nenhum atendimento futuro.">
              <thead><tr><th className={TH}>Quando</th><th className={TH}>Cliente</th><th className={TH}>Serviço</th><th className={TH}>Profissional</th><th className={TH}>Situação</th></tr></thead>
              <tbody>
                {d.upcoming.map((a) => (
                  <tr key={a.id} className="border-t border-border">
                    <td className={TD}><Link className="underline underline-offset-2" href={`/agendamentos/${a.id}`}><DateTimeLocal value={a.starts_at} tz={c.tz} /></Link></td>
                    <td className={TD}>{a.customer}</td><td className={TD}>{a.service}</td><td className={TD}>{a.professional}</td><td className={TD}><StatusPill status={a.status} /></td>
                  </tr>
                ))}
              </tbody>
            </TableShell>
          </Section>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card title="Serviços mais agendados" description="Sem contar cancelados."><Bars rows={d.by_service} label="Serviços mais agendados" /></Card>
            <Card title="Volume por profissional" description="Sem contar cancelados."><Bars rows={d.by_professional} label="Volume por profissional" /></Card>
            <Card title="Distribuição por status">
              <Bars label="Distribuição por status" rows={Object.entries(d.by_status).map(([k, v]) => ({ name: STATUS_LABEL[k as Status] ?? k, count: v })).sort((a, b) => b.count - a.count)} />
            </Card>
          </div>
          <p className="mt-6 text-xs text-muted">O sistema não controla pagamentos: por isso não há faturamento nem taxa de ocupação. O preço informado nos serviços é apenas referência.</p>
        </>
      )}
    </>
  );
}
