import type { Metadata } from 'next';
import Link from 'next/link';
import { AgForm, AreaF, FieldError, SelectF, TextF } from '@/components/ag/fields';
import { Card, PageHeader } from '@/components/ui/primitives';
import { createAppointment } from '@/lib/scheduling/actions/appointments';
import { listProfessionals, listServices, professionalServiceMap } from '@/lib/scheduling/data';
import { pageCtx } from '@/lib/scheduling/page';
import { isIsoDate, one, safeSearch, uuidOrNull, type SearchParams } from '@/lib/scheduling/query';
import { formatDateLong, instantToLocal } from '@/lib/scheduling/time';

export const metadata: Metadata = { title: 'Novo agendamento' };

// Passo 1 (GET): serviço, profissional e data → lista de horários livres vinda do banco. Passo 2 (POST): horário + cliente. O servidor valida de novo ao gravar.
export default async function NewAppointmentPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const c = await pageCtx(['owner', 'manager']);
  const sp = await searchParams;
  const [profs, services, links] = await Promise.all([listProfessionals(c.ctx, c.org, true), listServices(c.ctx, c.org, true), professionalServiceMap(c.ctx, c.org)]);
  const serviceId = uuidOrNull(one(sp.service));
  const eligible = serviceId ? profs.filter((p) => (links.get(p.id) ?? []).includes(serviceId)) : profs;
  const profId = uuidOrNull(one(sp.prof));
  const date = isIsoDate(one(sp.date)) ? one(sp.date)! : c.today;
  const ready = !!serviceId && !!profId && eligible.some((p) => p.id === profId);
  const q = safeSearch(one(sp.q));

  let times: Array<{ at: string; label: string }> = [];
  let slotsError = '';
  if (ready) {
    const { data, error } = await c.ctx.supabase.rpc('ag_slots', { p_org: c.org, p_prof: profId, p_svc: serviceId, p_from: date, p_to: date });
    if (error) slotsError = 'Não foi possível carregar os horários.';
    times = ((data ?? []) as Array<{ at: string }>).map((x) => ({ at: x.at, label: instantToLocal(Date.parse(x.at), c.tz).time }));
  }
  let customers: Array<{ id: string; name: string; phone: string | null }> = [];
  if (ready && q) {
    const { data } = await c.ctx.supabase.from('customers').select('id, name, phone').eq('organization_id', c.org).is('anonymized_at', null).ilike('name', `%${q}%`).order('name').limit(30);
    customers = (data ?? []) as typeof customers;
  }
  const svc = services.find((s) => s.id === serviceId);

  return (
    <>
      <PageHeader title="Novo agendamento" description="Escolha o serviço, o profissional e a data para ver os horários livres. A equipe pode usar qualquer horário livre dentro do expediente." />
      <Card title="1. Serviço, profissional e data">
        <form method="get" className="grid gap-4 sm:grid-cols-4" aria-label="Buscar horários">
          <label className="flex flex-col gap-1 text-sm font-medium">Serviço
            <select name="service" defaultValue={serviceId ?? ''} className="min-h-10 rounded-md border border-border bg-card px-2 font-normal" required>
              <option value="">Selecione…</option>{services.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.duration_minutes} min)</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">Profissional
            <select name="prof" defaultValue={profId ?? ''} className="min-h-10 rounded-md border border-border bg-card px-2 font-normal" required>
              <option value="">Selecione…</option>{eligible.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">Data
            <input type="date" name="date" defaultValue={date} className="min-h-10 rounded-md border border-border bg-card px-2 font-normal" required />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">Buscar cliente (nome)
            <input type="search" name="q" defaultValue={q ?? ''} placeholder="Opcional" className="min-h-10 rounded-md border border-border bg-card px-2 font-normal" />
          </label>
          <div className="sm:col-span-4"><button type="submit" className="inline-flex min-h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90">Ver horários livres</button></div>
        </form>
        {serviceId && eligible.length === 0 ? <p className="mt-3 text-sm text-danger" role="alert">Nenhum profissional ativo realiza este serviço. Associe em <Link className="underline" href="/profissionais">Profissionais</Link>.</p> : null}
      </Card>

      {ready ? (
        <div className="mt-6">
          <Card title={`2. Horário e cliente — ${formatDateLong(date)}`} description={svc ? `${svc.name}: ${svc.duration_minutes} min${svc.buffer_before_minutes || svc.buffer_after_minutes ? ` (+${svc.buffer_before_minutes} antes / +${svc.buffer_after_minutes} depois de intervalo)` : ''}.` : undefined}>
            {slotsError ? <p role="alert" className="text-sm text-danger">{slotsError}</p> : times.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted">Sem horários livres nesta data para este profissional. Tente outra data ou confira a <Link className="underline" href="/disponibilidade">disponibilidade</Link>.</p>
            ) : (
              <AgForm action={createAppointment} submit="Criar agendamento" pending="Criando…" reset={false}>
                <>
                    <input type="hidden" name="service" value={serviceId!} /><input type="hidden" name="prof" value={profId!} />
                    <fieldset className="sm:col-span-4">
                      <legend className="mb-2 text-sm font-medium">Horário</legend>
                      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6 lg:grid-cols-8">
                        {times.map((t, i) => (
                          <label key={t.at} className="flex min-h-10 cursor-pointer items-center justify-center rounded-md border border-border text-sm tabular-nums has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-primary-foreground hover:bg-black/5 dark:hover:bg-white/5">
                            <input type="radio" name="slot" value={t.at} required={i === 0} className="sr-only" />{t.label}
                          </label>
                        ))}
                      </div>
                      <FieldError name="slot" />
                    </fieldset>
                    <fieldset className="sm:col-span-4 grid gap-4 sm:grid-cols-4">
                      <legend className="mb-2 text-sm font-medium">Cliente</legend>
                      <SelectF name="customer" label="Cliente existente" placeholder="— novo cliente (preencha ao lado) —" opts={customers.map((x) => ({ value: x.id, label: `${x.name}${x.phone ? ` · ${x.phone}` : ''}` }))} hint={q ? `${customers.length} resultado(s) para «${q}»` : 'Busque pelo nome acima para listar clientes cadastrados.'} span />
                      <TextF name="new_name" label="Nome do novo cliente" max={120} />
                      <TextF name="new_phone" label="Telefone" type="tel" max={30} />
                      <TextF name="new_email" label="E-mail" type="email" max={200} span />
                    </fieldset>
                    <AreaF name="notes" label="Notas internas (opcional)" hint="Visíveis só à equipe; nunca aparecem para o cliente." max={1000} />
                  </>
              </AgForm>
            )}
          </Card>
        </div>
      ) : null}
    </>
  );
}
