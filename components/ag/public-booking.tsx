'use client';

import { useCallback, useId, useMemo, useState } from 'react';
import { FormMessage, SubmitButton } from '@/components/ui/client';
import type { ActionState } from '@/lib/actions/result';
import { publicBook, publicSlots, type PublicSlots } from '@/lib/scheduling/actions/public';
import { swatchOf } from '@/lib/scheduling/palette';
import { addDays, formatDateLong, instantToLocal } from '@/lib/scheduling/time';
import { cn } from '@/lib/utils';
import { useAgAction } from './use-ag-action';

export type PublicService = { id: string; name: string; description: string | null; duration: number; price_cents: number | null; professionals: Array<{ id: string; name: string; bio: string | null; color: string }> };
export type PublicPage = { slug: string; name: string; timezone: string; today: string; horizonDays: number; policy: string | null; contact: string | null; services: PublicService[] };

const brl = (c: number | null) => (c === null ? null : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(c / 100));
const dur = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`);
const btn = 'inline-flex min-h-11 items-center justify-center rounded-md border border-border px-4 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5';
const choice = (on: boolean) => cn('flex w-full min-h-14 flex-col items-start justify-center gap-0.5 rounded-lg border px-4 py-3 text-left text-sm', on ? 'border-primary ring-2 ring-primary' : 'border-border hover:bg-black/5 dark:hover:bg-white/5');

/** Reserva em passos: serviço → profissional → data → horário → seus dados → revisão. A disponibilidade exibida é indicativa; o servidor valida de novo ao confirmar. */
export function PublicBooking({ page }: { page: PublicPage }) {
  const uid = useId();
  const [serviceId, setServiceId] = useState('');
  const [profId, setProfId] = useState('');
  const [days, setDays] = useState<Array<{ date: string; times: string[] }>>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [date, setDate] = useState('');
  const [slot, setSlot] = useState('');
  const [reviewing, setReviewing] = useState(false);

  const service = page.services.find((s) => s.id === serviceId);
  const prof = service?.professionals.find((p) => p.id === profId);

  const load = useCallback(async (svc: string, pr: string) => {
    setLoading(true); setLoadError(''); setDays([]); setDate(''); setSlot('');
    const to = addDays(page.today, Math.min(page.horizonDays, 30));
    const r: PublicSlots = await publicSlots({ slug: page.slug, service: svc, professional: pr, from: page.today, to });
    setLoading(false);
    if (!r.ok) { setLoadError(r.message ?? 'Não foi possível carregar os horários.'); return; }
    setDays(r.days ?? []);
  }, [page.slug, page.today, page.horizonDays]);

  // «Esse horário acabou de ser reservado»: o servidor recusa com erro no campo do horário → recarrega as opções livres
  const book = useCallback(async (prev: ActionState, fd: FormData) => {
    const r = await publicBook(prev, fd);
    if (r.ok === false && r.fieldErrors?.slot && serviceId && profId) { setSlot(''); setReviewing(false); void load(serviceId, profId); }
    return r;
  }, [serviceId, profId, load]);
  const [state, formAction, ref] = useAgAction(book, { reset: false });

  const times = useMemo(() => days.find((d) => d.date === date)?.times ?? [], [days, date]);
  const slotLocal = slot ? instantToLocal(Date.parse(slot), page.timezone) : null;

  return (
    <div className="space-y-6">
      <section aria-labelledby={`${uid}-s1`}>
        <h2 id={`${uid}-s1`} className="mb-2 text-base font-semibold">1. Escolha o serviço</h2>
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-labelledby={`${uid}-s1`}>
          {page.services.map((s) => (
            <button key={s.id} type="button" role="radio" aria-checked={s.id === serviceId} className={choice(s.id === serviceId)}
              onClick={() => { setServiceId(s.id); setProfId(''); setDays([]); setDate(''); setSlot(''); setReviewing(false); if (s.professionals.length === 1) { setProfId(s.professionals[0]!.id); void load(s.id, s.professionals[0]!.id); } }}>
              <span className="font-medium">{s.name}</span>
              <span className="text-xs text-muted">{dur(s.duration)}{brl(s.price_cents) ? ` · a partir de ${brl(s.price_cents)}` : ''}</span>
              {s.description ? <span className="text-xs text-muted">{s.description}</span> : null}
            </button>
          ))}
        </div>
      </section>

      {service ? (
        <section aria-labelledby={`${uid}-s2`}>
          <h2 id={`${uid}-s2`} className="mb-2 text-base font-semibold">2. Escolha o profissional</h2>
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-labelledby={`${uid}-s2`}>
            {service.professionals.map((p) => (
              <button key={p.id} type="button" role="radio" aria-checked={p.id === profId} className={choice(p.id === profId)}
                onClick={() => { setProfId(p.id); setSlot(''); setReviewing(false); void load(service.id, p.id); }}>
                <span className="flex items-center gap-2 font-medium"><span aria-hidden className={cn('size-3 rounded-full', swatchOf(p.color).dot)} />{p.name}</span>
                {p.bio ? <span className="text-xs text-muted">{p.bio}</span> : null}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {service && prof ? (
        <section aria-labelledby={`${uid}-s3`}>
          <h2 id={`${uid}-s3`} className="mb-1 text-base font-semibold">3. Escolha a data e o horário</h2>
          <p className="mb-2 text-xs text-muted">Horários no fuso <strong>{page.timezone}</strong> (o da empresa).</p>
          <div aria-live="polite" className="min-h-6 text-sm text-muted">{loading ? 'Carregando horários…' : null}</div>
          {loadError ? <p role="alert" className="text-sm text-danger">{loadError} <button type="button" className="underline" onClick={() => void load(service.id, prof.id)}>Tentar de novo</button></p> : null}
          {!loading && !loadError && days.length === 0 ? <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted">Sem horários livres nos próximos dias para esta combinação. Tente outro profissional ou fale com a empresa.</p> : null}
          {days.length > 0 ? (
            <>
              <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2" role="listbox" aria-label="Datas com horários livres">
                {days.map((d) => (
                  <button key={d.date} type="button" role="option" aria-selected={d.date === date} onClick={() => { setDate(d.date); setSlot(''); setReviewing(false); }}
                    className={cn('flex min-h-14 min-w-20 shrink-0 flex-col items-center justify-center rounded-lg border px-3 text-sm', d.date === date ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-black/5 dark:hover:bg-white/5')}>
                    <span className="text-xs capitalize">{formatDateLong(d.date).split(',')[0]!.slice(0, 3)}</span>
                    <span className="font-semibold tabular-nums">{d.date.slice(8, 10)}/{d.date.slice(5, 7)}</span>
                  </button>
                ))}
              </div>
              {date ? (
                <div className="mt-2" role="radiogroup" aria-label={`Horários em ${formatDateLong(date)}`}>
                  <p className="mb-2 text-sm font-medium capitalize">{formatDateLong(date)}</p>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                    {times.map((t) => {
                      const hhmm = instantToLocal(Date.parse(t), page.timezone).time;
                      return (
                        <button key={t} type="button" role="radio" aria-checked={t === slot} onClick={() => { setSlot(t); setReviewing(false); }}
                          className={cn('min-h-11 rounded-md border text-sm tabular-nums', t === slot ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-black/5 dark:hover:bg-white/5')}>{hhmm}</button>
                      );
                    })}
                  </div>
                </div>
              ) : <p className="text-sm text-muted">Escolha uma data para ver os horários.</p>}
            </>
          ) : null}
        </section>
      ) : null}

      {service && prof && slot ? (
        <form ref={ref} action={formAction} className="space-y-4" noValidate>
          <input type="hidden" name="slug" value={page.slug} />
          <input type="hidden" name="service" value={service.id} />
          <input type="hidden" name="professional" value={prof.id} />
          <input type="hidden" name="slot" value={slot} />
          <section aria-labelledby={`${uid}-s4`} className="space-y-3">
            <h2 id={`${uid}-s4`} className="text-base font-semibold">4. Seus dados</h2>
            <div>
              <label htmlFor={`${uid}-name`} className="mb-1 block text-sm font-medium">Nome completo</label>
              <input id={`${uid}-name`} name="name" autoComplete="name" required maxLength={120} defaultValue={state.values?.name ?? ''} className="min-h-11 w-full rounded-md border border-border bg-card px-3 text-base" aria-describedby={state.fieldErrors?.name ? `${uid}-name-e` : undefined} />
              {state.fieldErrors?.name ? <p id={`${uid}-name-e`} className="mt-1 text-xs text-danger">{state.fieldErrors.name[0]}</p> : null}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor={`${uid}-phone`} className="mb-1 block text-sm font-medium">Telefone / WhatsApp</label>
                <input id={`${uid}-phone`} name="phone" type="tel" inputMode="tel" autoComplete="tel" maxLength={30} defaultValue={state.values?.phone ?? ''} className="min-h-11 w-full rounded-md border border-border bg-card px-3 text-base" aria-describedby={state.fieldErrors?.phone ? `${uid}-phone-e` : undefined} />
                {state.fieldErrors?.phone ? <p id={`${uid}-phone-e`} className="mt-1 text-xs text-danger">{state.fieldErrors.phone[0]}</p> : null}
              </div>
              <div>
                <label htmlFor={`${uid}-email`} className="mb-1 block text-sm font-medium">E-mail</label>
                <input id={`${uid}-email`} name="email" type="email" autoComplete="email" maxLength={200} defaultValue={state.values?.email ?? ''} className="min-h-11 w-full rounded-md border border-border bg-card px-3 text-base" aria-describedby={state.fieldErrors?.email ? `${uid}-email-e` : undefined} />
                {state.fieldErrors?.email ? <p id={`${uid}-email-e`} className="mt-1 text-xs text-danger">{state.fieldErrors.email[0]}</p> : null}
              </div>
            </div>
            <p className="text-xs text-muted">Informe ao menos um contato. Usamos seus dados somente para esta reserva e para a empresa falar com você sobre ela.</p>
          </section>

          {!reviewing ? (
            <button type="button" className="inline-flex min-h-12 w-full items-center justify-center rounded-md bg-primary px-4 text-base font-medium text-primary-foreground hover:opacity-90" onClick={() => setReviewing(true)}>Revisar reserva</button>
          ) : (
            <section aria-labelledby={`${uid}-s5`} className="space-y-3 rounded-lg border border-border bg-card p-4">
              <h2 id={`${uid}-s5`} className="text-base font-semibold">5. Revise e confirme</h2>
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                <div><dt className="text-xs text-muted">Serviço</dt><dd>{service.name} · {dur(service.duration)}</dd></div>
                <div><dt className="text-xs text-muted">Profissional</dt><dd>{prof.name}</dd></div>
                <div><dt className="text-xs text-muted">Data e horário</dt><dd className="capitalize">{slotLocal ? `${formatDateLong(slotLocal.date)} às ${slotLocal.time}` : ''}</dd></div>
                {brl(service.price_cents) ? <div><dt className="text-xs text-muted">Valor de referência</dt><dd>{brl(service.price_cents)} (pago no atendimento)</dd></div> : null}
              </dl>
              {page.policy ? <p className="rounded-md bg-black/5 p-3 text-xs dark:bg-white/5"><strong>Política:</strong> {page.policy}</p> : null}
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="consent" className="mt-1 size-5" required />
                <span>Estou de acordo com o uso dos meus dados para esta reserva e com a política acima.</span>
              </label>
              {state.fieldErrors?.consent ? <p className="text-xs text-danger" role="alert">{state.fieldErrors.consent[0]}</p> : null}
              <div className="flex flex-wrap items-center gap-3">
                <SubmitButton pendingText="Confirmando…">Confirmar reserva</SubmitButton>
                <button type="button" className={btn} onClick={() => setReviewing(false)}>Voltar</button>
              </div>
            </section>
          )}
          <FormMessage state={state} />
        </form>
      ) : null}
    </div>
  );
}
