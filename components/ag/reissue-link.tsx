'use client';

import { useActionState, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FormMessage, SubmitButton } from '@/components/ui/client';
import { reissueLink } from '@/lib/scheduling/actions/appointments';
import type { ActionState } from '@/lib/actions/result';

/** Emite um novo link do cliente. O endereço completo existe só nesta resposta (o banco guarda apenas o hash). */
export function ReissueLink({ appt }: { appt: string }) {
  const router = useRouter();
  const [state, formAction] = useActionState(async (prev: ActionState, fd: FormData) => { const r = await reissueLink(prev, fd); if (r.ok) router.refresh(); return r; }, {} as ActionState);
  const [copied, setCopied] = useState(false);
  const link = state.values?.link;
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="appt" value={appt} />
      <SubmitButton pendingText="Emitindo…" variant="secondary">Emitir novo link</SubmitButton>
      {link ? (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <label htmlFor="novo-link" className="text-xs text-muted">Novo link (copie agora; não será exibido de novo)</label>
          <input id="novo-link" readOnly value={link} className="min-h-10 w-full rounded-md border border-border bg-card px-2 text-sm" onFocus={(e) => e.currentTarget.select()} />
          <button type="button" className="text-sm underline underline-offset-2" onClick={() => { void navigator.clipboard.writeText(link).then(() => setCopied(true)); }}>{copied ? 'Copiado' : 'Copiar link'}</button>
        </div>
      ) : null}
      <FormMessage state={state} />
    </form>
  );
}
