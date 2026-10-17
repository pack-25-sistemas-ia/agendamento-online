import type { Metadata } from 'next';
import Link from 'next/link';
import { AgForm, AreaF, CheckF, SelectF, TextF } from '@/components/ag/fields';
import { Badge, Card, PageHeader } from '@/components/ui/primitives';
import { TD, TH, TableShell } from '@/components/ag/bits';
import { saveProfessional } from '@/lib/scheduling/actions/registry';
import { listProfessionals, listServices, professionalServiceMap } from '@/lib/scheduling/data';
import { pageCtx } from '@/lib/scheduling/page';
import { one, uuidOrNull, type SearchParams } from '@/lib/scheduling/query';
import { PALETTE, swatchOf } from '@/lib/scheduling/palette';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Profissionais' };
type Member = { user_id: string; role: string; email: string | null; name: string | null; professional_id: string | null };

export default async function ProfessionalsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const c = await pageCtx(['owner', 'manager']);
  const sp = await searchParams;
  const [profs, services, links] = await Promise.all([listProfessionals(c.ctx, c.org), listServices(c.ctx, c.org), professionalServiceMap(c.ctx, c.org)]);
  const editId = uuidOrNull(one(sp.editar));
  const editing = editId ? profs.find((p) => p.id === editId) : undefined;
  const showForm = !!editing || one(sp.novo) === '1';
  let members: Member[] = [];
  if (c.isOwner && showForm) {
    const { data } = await c.ctx.supabase.rpc('ag_org_members', { p_org: c.org });
    members = ((data ?? []) as Member[]).filter((m) => m.role === 'member' && (!m.professional_id || m.professional_id === editing?.id));
  }
  const svcName = new Map(services.map((s) => [s.id, s.name]));

  return (
    <>
      <PageHeader title="Profissionais" description="Quem atende. Cada profissional faz apenas os serviços vinculados a ele e tem a própria disponibilidade.">
        {!showForm ? <Link href="/profissionais?novo=1" className="inline-flex min-h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90">Novo profissional</Link> : null}
      </PageHeader>

      {showForm ? (
        <Card title={editing ? `Editar — ${editing.name}` : 'Novo profissional'} className="mb-6">
          <AgForm action={saveProfessional} submit={editing ? 'Salvar alterações' : 'Cadastrar profissional'} reset={!editing}>
            <>
                {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
                <TextF name="name" label="Nome" def={editing?.name} required max={80} span />
                <SelectF name="color" label="Cor na agenda" def={editing?.display_color ?? PALETTE[0]!.hex} opts={PALETTE.map((s) => ({ value: s.hex, label: s.name }))} />
                <CheckF name="active" label="Ativo (aparece para reservas)" def={editing?.active ?? true} />
                <AreaF name="bio" label="Apresentação (aparece na página pública)" def={editing?.public_bio} max={300} />
                {c.isOwner ? (
                  <>
                    <input type="hidden" name="user_present" value="1" />
                    <SelectF name="user" label="Usuário vinculado (perfil Profissional)" def={editing?.linked_user_id ?? ''} placeholder="— sem login —" opts={members.map((m) => ({ value: m.user_id, label: m.name ? `${m.name} (${m.email ?? ''})` : (m.email ?? m.user_id) }))} hint="Só membros com papel «Membro». O profissional vê e conclui apenas os próprios atendimentos." span />
                  </>
                ) : <p className="sm:col-span-4 text-xs text-muted">Somente o proprietário vincula um usuário ao profissional.</p>}
                <fieldset className="sm:col-span-4">
                  <legend className="mb-2 text-sm font-medium">Serviços que realiza</legend>
                  {services.length === 0 ? <p className="text-sm text-muted">Cadastre serviços primeiro.</p> : (
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {services.map((s) => (
                        <label key={s.id} className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" name="service" value={s.id} defaultChecked={editing ? (links.get(editing.id) ?? []).includes(s.id) : false} className="size-4" /> {s.name}{s.active ? '' : ' (inativo)'}</label>
                      ))}
                    </div>
                  )}
                </fieldset>
              </>
          </AgForm>
          <p className="mt-3"><Link className="text-sm underline underline-offset-2" href="/profissionais">Fechar</Link></p>
        </Card>
      ) : null}

      <TableShell caption="Profissionais" empty={profs.length === 0} emptyText="Nenhum profissional cadastrado ainda.">
        <thead><tr><th className={TH}>Nome</th><th className={TH}>Serviços</th><th className={TH}>Situação</th><th className={TH}>Acesso</th><th className={TH}><span className="sr-only">Ações</span></th></tr></thead>
        <tbody>
          {profs.map((p) => (
            <tr key={p.id} className="border-t border-border">
              <td className={TD}><span className="inline-flex items-center gap-2"><span aria-hidden className={cn('size-3 rounded-full', swatchOf(p.display_color).dot)} />{p.name}</span></td>
              <td className={TD}>{(links.get(p.id) ?? []).map((id) => svcName.get(id)).filter(Boolean).join(', ') || <span className="text-muted">Nenhum</span>}</td>
              <td className={TD}><Badge tone={p.active ? 'success' : 'neutral'}>{p.active ? 'Ativo' : 'Inativo'}</Badge></td>
              <td className={TD}>{p.linked_user_id ? 'Com login' : <span className="text-muted">Sem login</span>}</td>
              <td className={TD}><span className="flex gap-3"><Link className="underline underline-offset-2" href={`/profissionais?editar=${p.id}`}>Editar</Link><Link className="underline underline-offset-2" href={`/disponibilidade?prof=${p.id}`}>Disponibilidade</Link></span></td>
            </tr>
          ))}
        </tbody>
      </TableShell>
    </>
  );
}
