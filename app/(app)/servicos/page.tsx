import type { Metadata } from 'next';
import Link from 'next/link';
import { AgForm, AreaF, CheckF, TextF } from '@/components/ag/fields';
import { TD, TH, TableShell, brl } from '@/components/ag/bits';
import { Badge, Card, PageHeader } from '@/components/ui/primitives';
import { saveService } from '@/lib/scheduling/actions/registry';
import { listServices } from '@/lib/scheduling/data';
import { pageCtx } from '@/lib/scheduling/page';
import { one, uuidOrNull, type SearchParams } from '@/lib/scheduling/query';

export const metadata: Metadata = { title: 'Serviços' };

const centsText = (c: number | null) => (c === null ? '' : (c / 100).toFixed(2).replace('.', ','));

export default async function ServicesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const c = await pageCtx(['owner', 'manager']);
  const sp = await searchParams;
  const services = await listServices(c.ctx, c.org);
  const editId = uuidOrNull(one(sp.editar));
  const editing = editId ? services.find((s) => s.id === editId) : undefined;
  const showForm = !!editing || one(sp.novo) === '1';

  return (
    <>
      <PageHeader title="Serviços" description="O que a empresa oferece. Duração e intervalos valem para NOVAS reservas; as já feitas guardam o retrato do momento da reserva.">
        {!showForm ? <Link href="/servicos?novo=1" className="inline-flex min-h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90">Novo serviço</Link> : null}
      </PageHeader>
      {showForm ? (
        <Card title={editing ? `Editar — ${editing.name}` : 'Novo serviço'} className="mb-6">
          <AgForm action={saveService} submit={editing ? 'Salvar alterações' : 'Cadastrar serviço'} reset={!editing}>
            <>
                {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
                <TextF name="name" label="Nome" def={editing?.name} required max={80} span />
                <TextF name="price" label="Preço de referência (R$)" def={centsText(editing?.reference_price_cents ?? null)} inputMode="decimal" hint="Opcional, só informativo (o sistema não cobra)." max={14} />
                <TextF name="duration" label="Duração (min)" def={String(editing?.duration_minutes ?? 30)} type="number" inputMode="numeric" required hint="5 a 720." />
                <TextF name="before" label="Intervalo antes (min)" def={String(editing?.buffer_before_minutes ?? 0)} type="number" inputMode="numeric" hint="Preparação; ocupa a agenda mas não aparece ao cliente." />
                <TextF name="after" label="Intervalo depois (min)" def={String(editing?.buffer_after_minutes ?? 0)} type="number" inputMode="numeric" hint="Limpeza/descanso; ocupa a agenda." />
                <AreaF name="description" label="Descrição (aparece na página pública)" def={editing?.description} max={400} />
                <CheckF name="active" label="Ativo (aceita novas reservas)" def={editing?.active ?? true} />
                <CheckF name="is_public" label="Disponível na página pública" def={editing?.public_booking_enabled ?? true} />
              </>
          </AgForm>
          <p className="mt-3"><Link className="text-sm underline underline-offset-2" href="/servicos">Fechar</Link></p>
        </Card>
      ) : null}
      <TableShell caption="Serviços" empty={services.length === 0} emptyText="Nenhum serviço cadastrado ainda.">
        <thead><tr><th className={TH}>Serviço</th><th className={TH}>Duração</th><th className={TH}>Intervalos</th><th className={TH}>Preço de referência</th><th className={TH}>Situação</th><th className={TH}><span className="sr-only">Ações</span></th></tr></thead>
        <tbody>
          {services.map((s) => (
            <tr key={s.id} className="border-t border-border">
              <td className={TD}>{s.name}</td>
              <td className={TD}>{s.duration_minutes} min</td>
              <td className={TD}>{s.buffer_before_minutes} antes · {s.buffer_after_minutes} depois</td>
              <td className={TD}>{brl(s.reference_price_cents)}</td>
              <td className={TD}><span className="flex flex-wrap gap-1"><Badge tone={s.active ? 'success' : 'neutral'}>{s.active ? 'Ativo' : 'Inativo'}</Badge><Badge tone={s.public_booking_enabled ? 'neutral' : 'warning'}>{s.public_booking_enabled ? 'Público' : 'Só equipe'}</Badge></span></td>
              <td className={TD}><Link className="underline underline-offset-2" href={`/servicos?editar=${s.id}`}>Editar</Link></td>
            </tr>
          ))}
        </tbody>
      </TableShell>
    </>
  );
}
