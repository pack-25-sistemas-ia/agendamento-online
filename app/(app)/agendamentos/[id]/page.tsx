import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionButton, AgForm, AreaF, FieldError } from '@/components/ag/fields';
import { DateTimeLocal, DefinitionList, Disclosure, Section, StatusPill, brl } from '@/components/ag/bits';
import { ReissueLink } from '@/components/ag/reissue-link';
import { Card, PageHeader } from '@/components/ui/primitives';
import { rescheduleAppointment, setStatus, updateNotes } from '@/lib/scheduling/actions/appointments';
import { APPT_SELECT, listProfessionals, professionalServiceMap, type ApptRow } from '@/lib/scheduling/data';
import { pageCtx } from '@/lib/scheduling/page';
import { isIsoDate, one, uuidOrNull, type SearchParams } from '@/lib/scheduling/query';
import { ACTOR_LABEL, ACTION_LABEL, EVENT_LABEL, SOURCE_LABEL, availableActions, type Status } from '@/lib/scheduling/status';
import { formatDateLong, instantToLocal } from '@/lib/scheduling/time';

export const metadata: Metadata = { title: 'Agendamento' };
type Ev = { id: string; event_type: string; actor_type: string; safe_metadata: Record<string, unknown>; created_at: string };

export default async function AppointmentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const { id } = await params;
  const sp = await searchParams;
  const c = await pageCtx(['owner', 'manager', 'professional']);
  if (!uuidOrNull(id)) notFound();
  const { data } = await c.ctx.supabase.from('appointments').select(APPT_SELECT).eq('id', id).eq('organization_id', c.org).maybeSingle();
  const a = data as unknown as ApptRow | null;
  if (!a) notFound(); // outro profissional/empresa: para você, não existe
  const { data: evData } = await c.ctx.supabase.from('appointment_events').select('id, event_type, actor_type, safe_metadata, created_at').eq('appointment_id', id).order('created_at', { ascending: true });
  const events = (evData ?? []) as Ev[];
  const start = instantToLocal(Date.parse(a.starts_at), c.tz);
  const status = a.status as Status;
  const actions = availableActions({ status, startsAtMs: Date.parse(a.starts_at), nowMs: c.now, profile: c.profile!, own: a.professional_id === c.professionalId });
  const has = (x: (typeof actions)[number]) => actions.includes(x);

  // remarcação: o banco lista os horários livres usando a duração do momento da reserva
  const reschedule = has('reschedule') && one(sp.reagendar) === '1';
  const rDate = isIsoDate(one(sp.date)) ? one(sp.date)! : start.date;
  const rProf = uuidOrNull(one(sp.prof)) ?? a.professional_id;
  let times: Array<{ at: string; label: string }> = [];
  let profOptions: Array<{ value: string; label: string }> = [];
  if (reschedule) {
    const [profs, links] = await Promise.all([listProfessionals(c.ctx, c.org, true), professionalServiceMap(c.ctx, c.org)]);
    profOptions = profs.filter((p) => (links.get(p.id) ?? []).includes(a.service_id)).map((p) => ({ value: p.id, label: p.name }));
    const r = await c.ctx.supabase.rpc('ag_reschedule_slots', { p_org: c.org, p_appt: a.id, p_prof: rProf, p_from: rDate, p_to: rDate });
    times = ((r.data ?? []) as Array<{ at: string }>).map((x) => ({ at: x.at, label: instantToLocal(Date.parse(x.at), c.tz).time }));
  }
  const cust = a.customers;

  return (
    <>
      <PageHeader title={`${a.service_name_snapshot} — ${cust?.name ?? 'Cliente'}`} description={`${formatDateLong(start.date)} às ${start.time} · fuso ${c.tz}`}>
        <div className="flex items-center gap-3"><StatusPill status={a.status} /><Link className="text-sm underline underline-offset-2" href="/agenda">Voltar à agenda</Link></div>
      </PageHeader>

      <Card title="Detalhes">
        <DefinitionList items={[
          ['Cliente', cust?.name ?? '—'], ['Telefone', cust?.phone ?? '—'], ['E-mail', cust?.email ?? '—'],
          ['Serviço', `${a.service_name_snapshot} · ${a.duration_minutes_snapshot} min`], ['Profissional', a.professionals?.name ?? '—'], ['Origem', SOURCE_LABEL[a.source] ?? a.source],
          ['Início', <DateTimeLocal key="s" value={a.starts_at} tz={c.tz} />], ['Fim', <DateTimeLocal key="e" value={a.ends_at} tz={c.tz} />], ['Valor de referência', brl(a.reference_price_cents_snapshot)],
          ...(a.cancellation_reason ? [['Motivo do cancelamento', a.cancellation_reason] as [string, string]] : []),
        ]} />
        <p className="mt-3 text-xs text-muted">Duração, intervalos e valor são os do momento da reserva; mudar o serviço depois não altera este atendimento.</p>
      </Card>

      <div className="mt-6 space-y-4">
        {actions.length === 0 ? <p className="text-sm text-muted">Este atendimento está {status === 'cancelled' ? 'cancelado' : status === 'completed' ? 'concluído' : 'encerrado'}; não há ações pendentes.</p> : (
          <div className="flex flex-wrap items-start gap-3">
            {has('confirm') ? <ActionButton action={setStatus} fields={{ appt: a.id, action: 'confirm' }} label={ACTION_LABEL.confirm} variant="primary" pending="Confirmando…" /> : null}
            {has('complete') ? <ActionButton action={setStatus} fields={{ appt: a.id, action: 'complete' }} label={ACTION_LABEL.complete} pending="Salvando…" /> : null}
            {has('no_show') ? <ActionButton action={setStatus} fields={{ appt: a.id, action: 'no_show' }} label={ACTION_LABEL.no_show} confirm="Registrar que o cliente não compareceu?" variant="danger" pending="Salvando…" /> : null}
            {has('reschedule') ? <Link href={`/agendamentos/${a.id}?reagendar=1`} className="inline-flex min-h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5">{ACTION_LABEL.reschedule}</Link> : null}
          </div>
        )}

        {reschedule ? (
          <Card title="Reagendar" description="Escolha a data (e, se quiser, outro profissional que faça o serviço). A reserva atual só muda quando você confirmar; se o horário for tomado antes, nada é alterado.">
            <form method="get" className="mb-4 grid gap-3 sm:grid-cols-4" aria-label="Buscar horários para reagendar">
              <input type="hidden" name="reagendar" value="1" />
              <label className="flex flex-col gap-1 text-sm font-medium">Data<input type="date" name="date" defaultValue={rDate} className="min-h-10 rounded-md border border-border bg-card px-2 font-normal" /></label>
              <label className="flex flex-col gap-1 text-sm font-medium">Profissional
                <select name="prof" defaultValue={rProf} className="min-h-10 rounded-md border border-border bg-card px-2 font-normal">{profOptions.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</select>
              </label>
              <div className="flex items-end"><button type="submit" className="inline-flex min-h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5">Ver horários</button></div>
            </form>
            {times.length === 0 ? <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted">Sem horários livres nesta data. Tente outra data.</p> : (
              <AgForm action={rescheduleAppointment} submit="Confirmar novo horário" pending="Reagendando…" reset={false}>
                <>
                    <input type="hidden" name="appt" value={a.id} /><input type="hidden" name="prof" value={rProf === a.professional_id ? '' : rProf} />
                    <fieldset className="sm:col-span-4">
                      <legend className="mb-2 text-sm font-medium">Novo horário em {formatDateLong(rDate)}</legend>
                      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6 lg:grid-cols-8">
                        {times.map((t, i) => (
                          <label key={t.at} className="flex min-h-10 cursor-pointer items-center justify-center rounded-md border border-border text-sm tabular-nums has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-primary-foreground hover:bg-black/5 dark:hover:bg-white/5">
                            <input type="radio" name="slot" value={t.at} required={i === 0} className="sr-only" />{t.label}
                          </label>
                        ))}
                      </div>
                      <FieldError name="slot" />
                    </fieldset>
                  </>
              </AgForm>
            )}
          </Card>
        ) : null}

        {has('cancel') ? (
          <Disclosure summary="Cancelar atendimento" tone="danger">
            <AgForm action={setStatus} submit="Confirmar cancelamento" pending="Cancelando…" variant="danger" reset={false}>
              <><input type="hidden" name="appt" value={a.id} /><input type="hidden" name="action" value="cancel" /><AreaF name="reason" label="Motivo (opcional)" max={300} hint="Cancelar libera o horário na hora e revoga o link do cliente. O registro permanece no histórico." /></>
            </AgForm>
          </Disclosure>
        ) : null}
      </div>

      <Section title="Notas internas" description="Visíveis só à equipe. Nunca aparecem para o cliente.">
        <AgForm action={updateNotes} submit="Salvar notas" reset={false}>
          <><input type="hidden" name="appt" value={a.id} /><AreaF name="notes" label="Notas" def={a.internal_notes ?? ''} max={1000} /></>
        </AgForm>
      </Section>

      {c.isManager && (status === 'scheduled' || status === 'confirmed') ? (
        <Section title="Link de gerenciamento do cliente" description="Se o cliente perdeu o link, emita outro. O anterior deixa de valer e o novo endereço aparece só uma vez.">
          <ReissueLink appt={a.id} />
        </Section>
      ) : null}

      <Section title="Histórico">
        <ol className="divide-y divide-border rounded-lg border border-border bg-card">
          {events.map((e) => {
            const m = e.safe_metadata;
            const detail = e.event_type === 'rescheduled' && typeof m.from === 'string' && typeof m.to === 'string' ? ` — de ${instantToLocal(Date.parse(m.from), c.tz).time} (${instantToLocal(Date.parse(m.from), c.tz).date.split('-').reverse().join('/')}) para ${instantToLocal(Date.parse(m.to), c.tz).time} (${instantToLocal(Date.parse(m.to), c.tz).date.split('-').reverse().join('/')})${m.professional_changed ? ', com troca de profissional' : ''}` : '';
            return (
              <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2 text-sm">
                <span>{EVENT_LABEL[e.event_type] ?? e.event_type}{detail} <span className="text-xs text-muted">· {ACTOR_LABEL[e.actor_type] ?? e.actor_type}</span></span>
                <DateTimeLocal value={e.created_at} tz={c.tz} />
              </li>
            );
          })}
        </ol>
      </Section>
    </>
  );
}
