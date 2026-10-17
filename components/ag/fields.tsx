'use client';

import { createContext, useContext, useId, useState, type ReactNode } from 'react';
import { FormMessage, SubmitButton } from '@/components/ui/client';
import { Field, Input, Select, Textarea } from '@/components/ui/primitives';
import type { ActionState } from '@/lib/actions/result';
import type { Opt } from './bits';
import { useAgAction } from './use-ag-action';

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState & { redirectTo?: string }>;
type Ctx = { e: Record<string, string[]>; v: Record<string, string>; id: (n: string) => string };
const FormCtx = createContext<Ctx>({ e: {}, v: {}, id: (n) => n });
const useF = (): Ctx => useContext(FormCtx);

/**
 * Formulário ligado a uma Server Action: erros por campo, valores preservados em falha, confirmação que sobrevive à atualização.
 * Os campos (TextF, SelectF…) leem erros e valores do CONTEXTO — assim o formulário aceita filhos comuns (JSX) vindos de Server Components
 * (uma função como `children` não atravessa a fronteira Server → Client).
 */
export function AgForm({ action, submit, pending = 'Salvando…', reset = true, variant, className = 'grid gap-4 sm:grid-cols-4', children }: {
  action: Action; submit: string; pending?: string; reset?: boolean; variant?: 'primary' | 'secondary' | 'danger'; className?: string; children: ReactNode;
}) {
  const p = useId();
  const [state, formAction, ref] = useAgAction(action, { reset });
  const ctx: Ctx = { e: state.fieldErrors ?? {}, v: state.values ?? {}, id: (n) => `${p}${n}` };
  return (
    <FormCtx.Provider value={ctx}>
      <form ref={ref} action={formAction} className={className} noValidate>
        {children}
        <div className="sm:col-span-4 flex flex-wrap items-center gap-3"><SubmitButton pendingText={pending} variant={variant}>{submit}</SubmitButton><FormMessage state={state} /></div>
      </form>
    </FormCtx.Provider>
  );
}

export const OptionList = ({ opts, placeholder }: { opts: Opt[]; placeholder?: string }) => (
  <>{placeholder !== undefined ? <option value="">{placeholder}</option> : null}{opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</>
);

/** Erro de um campo montado à mão (ex.: grupo de horários). */
export function FieldError({ name }: { name: string }) {
  const f = useF();
  return f.e[name]?.[0] ? <p className="mt-1 text-xs text-danger" role="alert">{f.e[name]![0]}</p> : null;
}

export function TextF({ name, label, def, hint, required, max, inputMode, type = 'text', span, placeholder }: { name: string; label: string; def?: string | null; hint?: string; required?: boolean; max?: number; inputMode?: 'decimal' | 'numeric' | 'text'; type?: string; span?: boolean; placeholder?: string }) {
  const f = useF();
  const body = <Field label={label} name={f.id(name)} errors={f.e[name]} hint={hint}><Input id={f.id(name)} name={name} type={type} required={required} maxLength={max} inputMode={inputMode} placeholder={placeholder} defaultValue={f.v[name] ?? def ?? ''} /></Field>;
  return span ? <div className="sm:col-span-2">{body}</div> : body;
}
export function SelectF({ name, label, opts, def, placeholder, hint, required, span }: { name: string; label: string; opts: Opt[]; def?: string | null; placeholder?: string; hint?: string; required?: boolean; span?: boolean }) {
  const f = useF();
  const body = <Field label={label} name={f.id(name)} errors={f.e[name]} hint={hint}><Select id={f.id(name)} name={name} required={required} defaultValue={f.v[name] ?? def ?? ''}><OptionList opts={opts} placeholder={placeholder} /></Select></Field>;
  return span ? <div className="sm:col-span-2">{body}</div> : body;
}
export function AreaF({ name, label, def, hint, max = 500 }: { name: string; label: string; def?: string | null; hint?: string; max?: number }) {
  const f = useF();
  return <div className="sm:col-span-4"><Field label={label} name={f.id(name)} errors={f.e[name]} hint={hint}><Textarea id={f.id(name)} name={name} rows={3} maxLength={max} defaultValue={f.v[name] ?? def ?? ''} /></Field></div>;
}
export function CheckF({ name, label, def }: { name: string; label: string; def?: boolean }) {
  const f = useF();
  const [on, setOn] = useState(def ?? false);
  return (
    <label className="flex min-h-10 items-center gap-2 text-sm" htmlFor={f.id(name)}>
      <input id={f.id(name)} type="checkbox" name={name} checked={on} onChange={(e) => setOn(e.target.checked)} className="size-4" /> {label}
    </label>
  );
}

/** Botão de ação pontual (confirmar, concluir, remover…) com confirmação em duas etapas quando `confirm` é informado. */
export function ActionButton({ action, fields, label, pending = 'Enviando…', variant = 'secondary', confirm, className }: {
  action: Action; fields: Record<string, string>; label: string; pending?: string; variant?: 'primary' | 'secondary' | 'danger'; confirm?: string; className?: string;
}) {
  const [state, formAction, ref] = useAgAction(action, { reset: false });
  const [armed, setArmed] = useState(false);
  return (
    <form ref={ref} action={formAction} className={className ?? 'inline-flex flex-wrap items-center gap-2'}>
      {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {confirm && !armed ? (
        <button type="button" onClick={() => setArmed(true)} className="inline-flex min-h-10 items-center rounded-md border border-border px-3 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5">{label}</button>
      ) : (
        <>
          {confirm ? <span className="text-sm" role="alert">{confirm}</span> : null}
          <SubmitButton pendingText={pending} variant={variant}>{confirm ? 'Confirmar' : label}</SubmitButton>
          {confirm ? <button type="button" onClick={() => setArmed(false)} className="text-sm text-muted underline underline-offset-2">Voltar</button> : null}
        </>
      )}
      <FormMessage state={state} />
    </form>
  );
}
