import type { Metadata } from 'next';
import Link from 'next/link';
import { AgForm, TextF } from '@/components/ag/fields';
import { Disclosure, FilterForm, FInput, Pagination, TD, TH, TableShell } from '@/components/ag/bits';
import { PageHeader } from '@/components/ui/primitives';
import { saveCustomer } from '@/lib/scheduling/actions/registry';
import { pageCtx } from '@/lib/scheduling/page';
import { PAGE_SIZE, one, pageFrom, safeSearch, type SearchParams } from '@/lib/scheduling/query';

export const metadata: Metadata = { title: 'Clientes' };
type Row = { id: string; name: string; email: string | null; phone: string | null; anonymized_at: string | null };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const c = await pageCtx(['owner', 'manager']);
  const sp = await searchParams;
  const q = safeSearch(one(sp.q));
  const page = pageFrom(one(sp.page));
  let query = c.ctx.supabase.from('customers').select('id, name, email, phone, anonymized_at', { count: 'exact' }).eq('organization_id', c.org).order('name').range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (q) query = query.or(`name.ilike.%${q}%,email.ilike.%${q}%,phone.ilike.%${q}%`);
  const { data, count } = await query;
  const rows = (data ?? []) as Row[];
  return (
    <>
      <PageHeader title="Clientes" description="Quem já agendou ou foi cadastrado pela equipe. O sistema nunca junta clientes automaticamente por nome ou contato: um telefone pode ser compartilhado." />
      <div className="mb-5">
        <Disclosure summary="Novo cliente" tone="primary">
          <AgForm action={saveCustomer} submit="Cadastrar cliente">
            <><TextF name="name" label="Nome" required max={120} span /><TextF name="phone" label="Telefone" type="tel" max={30} /><TextF name="email" label="E-mail" type="email" max={200} /></>
          </AgForm>
        </Disclosure>
      </div>
      <FilterForm clear="/clientes"><FInput name="q" label="Buscar" sp={sp} placeholder="Nome, e-mail ou telefone" /></FilterForm>
      <TableShell caption="Clientes" empty={rows.length === 0} emptyText="Nenhum cliente encontrado.">
        <thead><tr><th className={TH}>Nome</th><th className={TH}>Telefone</th><th className={TH}>E-mail</th><th className={TH}><span className="sr-only">Ações</span></th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-border">
              <td className={TD}>{r.name}{r.anonymized_at ? <span className="ml-2 text-xs text-muted">(anonimizado)</span> : null}</td>
              <td className={TD}>{r.phone ?? '—'}</td><td className={TD}>{r.email ?? '—'}</td>
              <td className={TD}><Link className="underline underline-offset-2" href={`/clientes/${r.id}`}>Abrir</Link></td>
            </tr>
          ))}
        </tbody>
      </TableShell>
      <Pagination base="/clientes" sp={sp} page={page} total={count ?? 0} />
    </>
  );
}
