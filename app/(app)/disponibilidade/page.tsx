import type { Metadata } from 'next';
import Link from 'next/link';
import { ActionButton, AgForm, TextF } from '@/components/ag/fields';
import { OverrideForm, WeeklyEditor } from '@/components/ag/availability-editors';
import { DateTimeLocal, Section, TD, TH, TableShell } from '@/components/ag/bits';
import { Card, EmptyState, PageHeader } from '@/components/ui/primitives';
import { cancelBlock, createBlock, deleteOverride } from '@/lib/scheduling/actions/availability';
import { blocksOf, listProfessionals } from '@/lib/scheduling/data';
import { pageCtx } from '@/lib/scheduling/page';
import { one, uuidOrNull, type SearchParams } from '@/lib/scheduling/query';
import { formatDateLong, localToInstant, addDays } from '@/lib/scheduling/time';

export const metadata: Metadata = { title: 'Disponibilidade' };
type Rule = { weekday: number; local_start_time: string; local_end_time: string };
type Ov = { local_date: string; local_start_time: string | null; local_end_time: string | null };

export default async function AvailabilityPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const c = await pageCtx(['owner', 'manager']);
  const sp = await searchParams;
  const profs = await listProfessionals(c.ctx, c.org);
  if (profs.length === 0) return (<><PageHeader title="Disponibilidade" /><EmptyState title="Cadastre um profissional primeiro" description="A disponibilidade é definida por profissional."><Link className="text-sm underline" href="/profissionais?novo=1">Novo profissional</Link></EmptyState></>);
  const profId = uuidOrNull(one(sp.prof)) ?? profs.find((p) => p.active)?.id ?? profs[0]!.id;
  const prof = profs.find((p) => p.id === profId) ?? profs[0]!;

  const [r, o] = await Promise.all([
    c.ctx.supabase.from('availability_rules').select('weekday, local_start_time, local_end_time').eq('professional_id', prof.id).eq('active', true),
    c.ctx.supabase.from('availability_overrides').select('local_date, local_start_time, local_end_time').eq('professional_id', prof.id).gte('local_date', c.today).order('local_date').order('local_start_time'),
  ]);
  const blocks = await blocksOf(c.ctx, c.org, [prof.id], new Date(c.now).toISOString(), new Date(localToInstant(addDays(c.today, 800), '00:00', c.tz)).toISOString());
  const rules = ((r.data ?? []) as Rule[]).map((x) => ({ weekday: x.weekday, start: x.local_start_time.slice(0, 5), end: x.local_end_time.slice(0, 5) }));
  const overrides = new Map<string, Array<{ start: string; end: string }>>();
  for (const x of (o.data ?? []) as Ov[]) overrides.set(x.local_date, [...(overrides.get(x.local_date) ?? []), ...(x.local_start_time ? [{ start: x.local_start_time.slice(0, 5), end: x.local_end_time!.slice(0, 5) }] : [])]);

  return (
    <>
      <PageHeader title="Disponibilidade" description={`Horários de atendimento, exceções por data e bloqueios — sempre na hora local da empresa (${c.tz}).`} />
      <form method="get" className="mb-6 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">Profissional
          <select name="prof" defaultValue={prof.id} className="min-h-10 rounded-md border border-border bg-card px-2 text-sm font-normal text-foreground">{profs.map((p) => <option key={p.id} value={p.id}>{p.name}{p.active ? '' : ' (inativo)'}</option>)}</select>
        </label>
        <button type="submit" className="inline-flex min-h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5">Trocar</button>
      </form>

      <Section title={`Semana — ${prof.name}`} description="Vários intervalos por dia. Dia sem intervalos = fechado.">
        <WeeklyEditor key={prof.id} prof={prof.id} initial={rules} />
      </Section>

      <Section title="Exceções por data" description="Folga, horário especial, feriado. Nessa data a regra semanal é substituída.">
        <div className="mb-4"><OverrideForm key={prof.id} prof={prof.id} minDate={c.today} /></div>
        <TableShell caption="Exceções por data" empty={overrides.size === 0} emptyText="Nenhuma exceção futura.">
          <thead><tr><th className={TH}>Data</th><th className={TH}>Atendimento</th><th className={TH}><span className="sr-only">Ações</span></th></tr></thead>
          <tbody>
            {[...overrides.entries()].map(([d, spans]) => (
              <tr key={d} className="border-t border-border">
                <td className={`${TD} capitalize`}>{formatDateLong(d)}</td>
                <td className={TD}>{spans.length === 0 ? 'Dia fechado' : spans.map((s) => `${s.start}–${s.end}`).join(' · ')}</td>
                <td className={TD}><ActionButton action={deleteOverride} fields={{ prof: prof.id, date: d }} label="Remover" confirm="Remover esta exceção?" /></td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      </Section>

      <Section title="Bloqueios" description="Períodos em que o profissional não atende (curso, médico, férias). Disputam o mesmo espaço da agenda que as reservas: não é possível bloquear sobre um atendimento marcado.">
        <Card className="mb-4">
          <AgForm action={createBlock} submit="Criar bloqueio" pending="Criando…" reset>
            <>
                <input type="hidden" name="prof" value={prof.id} /><input type="hidden" name="tz" value={c.tz} />
                <TextF name="start_date" label="Início — data" type="date" required /><TextF name="start_time" label="Início — hora" type="time" def="09:00" required />
                <TextF name="end_date" label="Fim — data" type="date" required /><TextF name="end_time" label="Fim — hora" type="time" def="18:00" required />
                <TextF name="reason" label="Motivo (só a equipe vê)" max={200} span />
              </>
          </AgForm>
        </Card>
        <TableShell caption="Bloqueios futuros" empty={blocks.length === 0} emptyText="Nenhum bloqueio ativo.">
          <thead><tr><th className={TH}>De</th><th className={TH}>Até</th><th className={TH}>Motivo</th><th className={TH}><span className="sr-only">Ações</span></th></tr></thead>
          <tbody>
            {blocks.map((b) => (
              <tr key={b.id} className="border-t border-border">
                <td className={TD}><DateTimeLocal value={b.occupied_start_at} tz={c.tz} /></td><td className={TD}><DateTimeLocal value={b.occupied_end_at} tz={c.tz} /></td><td className={TD}>{b.block_reason ?? '—'}</td>
                <td className={TD}><ActionButton action={cancelBlock} fields={{ id: b.id }} label="Remover bloqueio" confirm="Remover este bloqueio? O horário volta a ser oferecido." /></td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      </Section>
    </>
  );
}
