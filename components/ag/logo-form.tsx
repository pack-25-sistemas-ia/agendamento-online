'use client';

import { useId } from 'react';
import { FormMessage, SubmitButton } from '@/components/ui/client';
import { removeLogo, uploadLogo } from '@/lib/scheduling/actions/settings';
import { useAgAction } from './use-ag-action';

export function LogoForm({ hasLogo }: { hasLogo: boolean }) {
  const id = useId();
  const [state, formAction, ref] = useAgAction(uploadLogo, { reset: true });
  const [rState, rAction] = useAgAction(async () => removeLogo(), { reset: false });
  return (
    <div className="space-y-4">
      <form ref={ref} action={formAction} className="space-y-3" encType="multipart/form-data">
        <label htmlFor={id} className="text-sm font-medium">Enviar novo logotipo</label>
        <input id={id} name="logo" type="file" accept="image/png,image/jpeg,image/webp" required className="block w-full text-sm" />
        {state.fieldErrors?.logo ? <p className="text-xs text-danger" role="alert">{state.fieldErrors.logo[0]}</p> : null}
        <div className="flex flex-wrap items-center gap-3"><SubmitButton pendingText="Enviando…">Enviar logotipo</SubmitButton><FormMessage state={state} /></div>
      </form>
      {hasLogo ? (
        <form action={rAction} className="flex flex-wrap items-center gap-3">
          <SubmitButton variant="secondary" pendingText="Removendo…">Remover logotipo atual</SubmitButton><FormMessage state={rState} />
        </form>
      ) : <p className="text-sm text-muted">Nenhum logotipo enviado.</p>}
    </div>
  );
}
