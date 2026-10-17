'use client';

export function PrintButton({ label = 'Imprimir comprovante' }: { label?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className="inline-flex min-h-11 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5">{label}</button>
  );
}
