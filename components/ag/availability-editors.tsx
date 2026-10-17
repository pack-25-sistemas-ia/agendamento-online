'use client';

import { useId, useState } from 'react';
import { FormMessage, SubmitButton } from '@/components/ui/client';
import { saveOverride, saveWeekly } from '@/lib/scheduling/actions/availability';
import { weekdayName } from '@/lib/scheduling/time';
import { cn } from '@/lib/utils';
import { useAgAction } from './use-ag-action';

type Span = { start: string; end: string };
const inputCls = 'min-h-10 rounded-md border border-border bg-card px-2 text-sm';
const smallBtn = 'inline-flex min-h-9 items-center rounded-md border border-border px-3 text-xs font-medium hover:bg-black/5 dark:hover:bg-white/5';
const order = [1, 2, 3, 4, 5, 6, 0]; // segunda … domingo

/** Editor de intervalos de um dia: vários intervalos (ex.: 09:00–12:00 e 13:00–18:00); intervalos que se tocam são aceitos, sobrepostos não. */
function SpanList({ spans, onChange, label }: { spans: Span[]; onChange: (s: Span[]) => void; label: string }) {
  const set = (i: number, patch: Partial<Span>) => onChange(spans.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  return (
    <div className="space-y-2">
      {spans.length === 0 ? <p className="text-sm text-muted">Fechado</p> : null}
      {spans.map((s, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor={`${label}-${i}-s`}>{label}: início do intervalo {i + 1}</label>
          <input id={`${label}-${i}-s`} type="time" value={s.start} onChange={(e) => set(i, { start: e.target.value })} className={inputCls} required />
          <span aria-hidden>até</span>
          <label className="sr-only" htmlFor={`${label}-${i}-e`}>{label}: fim do intervalo {i + 1}</label>
          <input id={`${label}-${i}-e`} type="time" value={s.end} onChange={(e) => set(i, { end: e.target.value })} className={inputCls} required />
          <button type="button" className={smallBtn} onClick={() => onChange(spans.filter((_, j) => j !== i))} aria-label={`Remover intervalo ${i + 1} de ${label}`}>Remover</button>
        </div>
      ))}
      <button type="button" className={smallBtn} onClick={() => onChange([...spans, { start: spans.length ? spans[spans.length - 1]!.end : '09:00', end: spans.length ? '18:00' : '12:00' }])}>+ Adicionar intervalo</button>
    </div>
  );
}

export function WeeklyEditor({ prof, initial }: { prof: string; initial: Array<{ weekday: number; start: string; end: string }> }) {
  const [days, setDays] = useState<Record<number, Span[]>>(() => {
    const m: Record<number, Span[]> = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
    for (const r of initial) m[r.weekday]!.push({ start: r.start, end: r.end });
    for (const k of Object.keys(m)) m[Number(k)]!.sort((a, b) => a.start.localeCompare(b.start));
    return m;
  });
  const [state, formAction, ref] = useAgAction(saveWeekly, { reset: false });
  const rules = JSON.stringify(order.flatMap((w) => (days[w] ?? []).map((s) => ({ weekday: w, start: s.start, end: s.end }))));
  return (
    <form ref={ref} action={formAction} className="space-y-4">
      <input type="hidden" name="prof" value={prof} />
      <input type="hidden" name="rules" value={rules} readOnly />
      <div className="divide-y divide-border rounded-lg border border-border bg-card">
        {order.map((w) => (
          <div key={w} className="grid gap-2 px-4 py-3 sm:grid-cols-[9rem_1fr]">
            <p className="text-sm font-medium capitalize">{weekdayName(w)}</p>
            <SpanList spans={days[w] ?? []} onChange={(s) => setDays((d) => ({ ...d, [w]: s }))} label={weekdayName(w)} />
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={smallBtn} onClick={() => setDays((d) => ({ ...d, 2: [...(d[1] ?? [])], 3: [...(d[1] ?? [])], 4: [...(d[1] ?? [])], 5: [...(d[1] ?? [])] }))}>Copiar segunda para terça–sexta</button>
        <SubmitButton pendingText="Salvando…">Salvar disponibilidade semanal</SubmitButton>
        <FormMessage state={state} />
      </div>
      <p className="text-xs text-muted">Horários na hora local da empresa. Para almoço, deixe o intervalo de fora (ex.: 09:00–12:00 e 13:00–18:00). Reservas já feitas não são alteradas.</p>
    </form>
  );
}

export function OverrideForm({ prof, minDate }: { prof: string; minDate: string }) {
  const uid = useId();
  const [mode, setMode] = useState<'closed' | 'hours'>('closed');
  const [spans, setSpans] = useState<Span[]>([{ start: '09:00', end: '12:00' }]);
  const [state, formAction, ref] = useAgAction(saveOverride, { reset: false });
  return (
    <form ref={ref} action={formAction} className="space-y-3 rounded-lg border border-border bg-card p-4">
      <input type="hidden" name="prof" value={prof} />
      <input type="hidden" name="mode" value={mode} />
      <input type="hidden" name="intervals" value={JSON.stringify(spans)} readOnly />
      <h3 className="text-sm font-semibold">Exceção para uma data</h3>
      <p className="text-xs text-muted">Nesta data valem somente os horários abaixo — a disponibilidade semanal não se aplica.</p>
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1 text-sm font-medium" htmlFor={`${uid}-d`}>Data<input id={`${uid}-d`} name="date" type="date" min={minDate} required className={cn(inputCls, 'font-normal')} /></label>
        <fieldset className="flex gap-4 text-sm">
          <legend className="sr-only">Tipo de exceção</legend>
          <label className="flex min-h-10 items-center gap-2"><input type="radio" name={`${uid}-m`} checked={mode === 'closed'} onChange={() => setMode('closed')} /> Dia fechado</label>
          <label className="flex min-h-10 items-center gap-2"><input type="radio" name={`${uid}-m`} checked={mode === 'hours'} onChange={() => setMode('hours')} /> Horários próprios</label>
        </fieldset>
      </div>
      {mode === 'hours' ? <SpanList spans={spans} onChange={setSpans} label="Exceção" /> : null}
      {state.fieldErrors?.date ? <p className="text-xs text-danger" role="alert">{state.fieldErrors.date[0]}</p> : null}
      <div className="flex flex-wrap items-center gap-3"><SubmitButton pendingText="Salvando…">Salvar exceção</SubmitButton><FormMessage state={state} /></div>
    </form>
  );
}
