import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AgForm, TextF } from '@/components/ag/fields';
import { DateTimeLocal, Disclosure, Kpi, Section, StatusPill, TD, TH, TableShell } from '@/components/ag/bits';
import { Card, PageHeader } from '@/components/ui/primitives';
import { anonymizeCustomer, saveCustomer } from '@/lib/scheduling/actions/registry';
import { pageCtx } from '@/lib/scheduling/page';
import { uuidOrNull } from '@/lib/scheduling/query';
import { STATUSES, STATUS_LABEL, type Status } from '@/lib/scheduling/status';

export const metadata: Metadata = { title: 'Cliente' };
type Appt = { id: string; starts_at: string; status: string; service_name_snapshot: string; professionals: { name: string } | null };

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await pageCtx(['owner', 'manager']);
  if (!uuidOrNull(id)) notFound();
  const { data } = await c.ctx.supabase.from('customers').select('id, name, email, phone, anonymized_at, created_at').eq('id', id).eq('organization_id', c.org).maybeSingle();
  const cust = data as { id: string; name: string; email: string | null; phone: string | null; anonymized_at: string | null; created_at: string } | null;
  if (!cust) notFound();
  const { data: ap } = await c.ctx.supabase.from('appointments').select('id, starts_at, status, service_name_snapshot, professionals(name)').eq('customer_id', id).order('starts_at', { ascending: false }).limit(100);
  const appts = (ap ?? []) as unknown as Appt[];
  const counts = new Map<string, number>();
  for (const a of appts) counts.set(a.status, (counts.get(a.status) ?? 0) + 1);
  const next = [...appts].reverse().find((a) => (a.status === 'scheduled' || a.status === 'confirmed') && Date.parse(a.starts_at) >= c.now);

  return (
    <>
      <PageHeader title={cust.name} description={cust.anonymized_at ? 'Dados pessoais anonimizados (LGPD). O histórico estatístico foi mantido.' : 'Dados de contato e histórico de atendimentos.'}>
        <Link href="/clientes" className="text-sm underline underline-offset-2">Voltar</Link>
      </PageHeader>
      <div className="mb-6 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {STATUSES.map((s) => <Kpi key={s} label={STATUS_LABEL[s]} value={counts.get(s) ?? 0} />)}
        <Kpi label="Próximo atendimento" value={next ? <DateTimeLocal value={next.starts_at} tz={c.tz} /> : '—'} />
      </div>
      {!cust.anonymized_at ? (
        <Card title="Dados do cliente">
          <AgForm action={saveCustomer} submit="Salvar" reset={false}>
            <><input type="hidden" name="id" value={cust.id} /><TextF name="name" label="Nome" def={cust.name} required max={120} span /><TextF name="phone" label="Telefone" def={cust.phone} type="tel" max={30} /><TextF name="email" label="E-mail" def={cust.email} type="email" max={200} /></>
          </AgForm>
        </Card>
      ) : null}
      <Section title="Histórico de atendimentos" description="Os 100 mais recentes.">
        <TableShell caption="Histórico do cliente" empty={appts.length === 0} emptyText="Este cliente ainda não tem atendimentos.">
          <thead><tr><th className={TH}>Quando</th><th className={TH}>Serviço</th><th className={TH}>Profissional</th><th className={TH}>Situação</th><th className={TH}><span className="sr-only">Ações</span></th></tr></thead>
          <tbody>
            {appts.map((a) => (
              <tr key={a.id} className="border-t border-border">
                <td className={TD}><DateTimeLocal value={a.starts_at} tz={c.tz} /></td><td className={TD}>{a.service_name_snapshot}</td><td className={TD}>{a.professionals?.name}</td>
                <td className={TD}><StatusPill status={a.status as Status} /></td><td className={TD}><Link className="underline underline-offset-2" href={`/agendamentos/${a.id}`}>Abrir</Link></td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      </Section>
      {c.isOwner && !cust.anonymized_at ? (
        <Disclosure summary="Anonimizar dados pessoais (LGPD)" tone="danger">
          <p className="mb-3 text-sm">Remove nome, telefone e e-mail deste cliente, limpa as notas internas dos atendimentos e revoga os links de gerenciamento. <strong>Não dá para desfazer.</strong> Os atendimentos continuam nas estatísticas, sem identificar a pessoa.</p>
          <AgForm action={anonymizeCustomer} submit="Anonimizar cliente" variant="danger" reset={false}>
            <><input type="hidden" name="id" value={cust.id} /><TextF name="confirm" label="Digite ANONIMIZAR para confirmar" span /></>
          </AgForm>
        </Disclosure>
      ) : null}
    </>
  );
}
