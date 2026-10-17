'use client';

import { useCallback, useId, useMemo, useState } from 'react';
import { FormMessage, SubmitButton } from '@/components/ui/client';
import { publicBookingSlots, publicCancel, publicReschedule } from '@/lib/scheduling/actions/public';
import { addDays, formatDateLong, instantToLocal } from '@/lib/scheduling/time';
import { cn } from '@/lib/utils';
import { useAgAction } from './use-ag-action';

const btn = 'inline-flex min-h-11 items-center justify-center rounded-md border border-border px-4 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5';

/** Cancelamento em duas etapas (confirmação explícita). */
export function CancelBooking({ token }: { token: string }) {
  const [state, formAction, ref] = useAgAction(publicCancel, { reset: false });
  const [armed, setArmed] = useState(false);
  return (
    <form ref={ref} action={formAction} className="space-y-3">
      <input type="hidden" name="token" value={token} />
      {!armed ? (
        <button type="button" className={cn(btn, 'text-danger')} onClick={() => setArmed(true)}>Cancelar reserva</button>
      ) : (
        <div className="space-y-3 rounded-lg border border-danger p-4" role="alertdialog" aria-labelledby="cancel-title">
          <p id="cancel-title" className="text-sm font-medium">Tem certeza que deseja cancelar esta reserva? O horário será liberado.</p>
          <div className="flex flex-wrap gap-3">
            <SubmitButton variant="danger" pendingText="Cancelando…">Sim, cancelar</SubmitButton>
            <button type="button" className={btn} onClick={() => setArmed(false)}>Manter reserva</button>
          </div>
        </div>
      )}
      <FormMessage state={state} />
    </form>
  );
}

/** Reagendamento: mesmo serviço e mesmo profissional; só o horário muda. A lista é indicativa — o servidor valida de novo. */
export function RescheduleBooking({ token, today, horizonDays, timezone }: { token: string; today: string; horizonDays: number; timezone: string }) {
  const uid = useId();
  const [state, formAction, ref] = useAgAction(publicReschedule, { reset: false });
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState<Array<{ date: string; times: string[] }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [date, setDate] = useState('');
  const [slot, setSlot] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError(''); setSlot('');
    const r = await publicBookingSlots(token, today, addDays(today, Math.min(horizonDays, 30)));
    setLoading(false);
    if (!r.ok) { setError(r.message ?? 'Não foi possível carregar os horários.'); return; }
    setDays(r.days ?? []);
  }, [token, today, horizonDays]);

  const times = useMemo(() => days.find((d) => d.date === date)?.times ?? [], [days, date]);
  if (!open) return <button type="button" className={btn} onClick={() => { setOpen(true); void load(); }}>Reagendar</button>;
  return (
    <form ref={ref} action={formAction} className="space-y-3 rounded-lg border border-border p-4">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="slot" value={slot} />
      <h3 className="text-sm font-semibold">Escolha o novo horário</h3>
      <p className="text-xs text-muted">Mesmo serviço e mesmo profissional. Horários no fuso <strong>{timezone}</strong>.</p>
      <div aria-live="polite" className="min-h-5 text-sm text-muted">{loading ? 'Carregando horários…' : null}</div>
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      {!loading && !error && days.length === 0 ? <p className="text-sm text-muted">Sem horários livres nos próximos dias. Fale com a empresa.</p> : null}
      {days.length > 0 ? (
        <>
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2" role="listbox" aria-label="Datas com horários livres">
            {days.map((d) => (
              <button key={d.date} type="button" role="option" aria-selected={d.date === date} onClick={() => { setDate(d.date); setSlot(''); }}
                className={cn('flex min-h-14 min-w-20 shrink-0 flex-col items-center justify-center rounded-lg border px-3 text-sm', d.date === date ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-black/5 dark:hover:bg-white/5')}>
                <span className="text-xs capitalize">{formatDateLong(d.date).split(',')[0]!.slice(0, 3)}</span>
                <span className="font-semibold tabular-nums">{d.date.slice(8, 10)}/{d.date.slice(5, 7)}</span>
              </button>
            ))}
          </div>
          {date ? (
            <div role="radiogroup" aria-label={`Horários em ${formatDateLong(date)}`} className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {times.map((t) => (
                <button key={t} type="button" role="radio" aria-checked={t === slot} onClick={() => setSlot(t)}
                  className={cn('min-h-11 rounded-md border text-sm tabular-nums', t === slot ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-black/5 dark:hover:bg-white/5')}>{instantToLocal(Date.parse(t), timezone).time}</button>
              ))}
            </div>
          ) : <p className="text-sm text-muted" id={`${uid}-h`}>Escolha uma data.</p>}
        </>
      ) : null}
      {state.fieldErrors?.slot ? <p role="alert" className="text-xs text-danger">{state.fieldErrors.slot[0]}</p> : null}
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingText="Reagendando…">Confirmar novo horário</SubmitButton>
        <button type="button" className={btn} onClick={() => setOpen(false)}>Voltar</button>
      </div>
      <FormMessage state={state} />
    </form>
  );
}
