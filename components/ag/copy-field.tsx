'use client';

import { useId, useState } from 'react';

export function CopyField({ label, value }: { label: string; value: string }) {
  const id = useId();
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      <div className="flex flex-wrap gap-2">
        <input id={id} readOnly value={value} className="min-h-10 min-w-0 flex-1 rounded-md border border-border bg-card px-2 text-sm" onFocus={(e) => e.currentTarget.select()} />
        <button type="button" className="inline-flex min-h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5"
          onClick={() => { void navigator.clipboard.writeText(value).then(() => setCopied(true)); }}>{copied ? 'Copiado' : 'Copiar'}</button>
      </div>
    </div>
  );
}
