import Link from 'next/link';
import { gridColsClass, gridRowsClass, rowSpanClass, rowStartClass } from '@/lib/scheduling/grid-classes';
import { swatchOf } from '@/lib/scheduling/palette';
import { fromMinutes } from '@/lib/scheduling/time';
import { cn } from '@/lib/utils';

export type GridItem = { id: string; kind: 'appt' | 'block'; startMin: number; endMin: number; title: string; sub: string; status?: string; href?: string; color: string };
export type GridCol = { key: string; title: string; subtitle?: string; windows: Array<{ startMin: number; endMin: number }>; items: GridItem[] };

const STEP = 15;

/** Grade de horários (dia = uma coluna por profissional; semana = uma coluna por dia). Posicionamento por CSS Grid com classes estáticas (a CSP proíbe style=""). */
export function AgendaGrid({ cols, startMin, endMin, label }: { cols: GridCol[]; startMin: number; endMin: number; label: string }) {
  const rows = Math.max(4, Math.ceil((endMin - startMin) / STEP));
  const rowOf = (m: number) => Math.floor((m - startMin) / STEP) + 1;
  const hours: number[] = [];
  for (let m = Math.ceil(startMin / 60) * 60; m < endMin; m += 60) hours.push(m);
  return (
    <div className="hidden overflow-x-auto rounded-lg border border-border bg-card md:block" role="region" aria-label={label} tabIndex={0}>
      <div className={cn('grid min-w-max border-b border-border', gridColsClass(cols.length))}>
        <div />
        {cols.map((c) => (
          <div key={c.key} className="border-l border-border px-2 py-2">
            <p className="truncate text-sm font-medium">{c.title}</p>
            {c.subtitle ? <p className="truncate text-xs text-muted">{c.subtitle}</p> : null}
          </div>
        ))}
      </div>
      <div className={cn('grid min-w-max', gridColsClass(cols.length))}>
        <div className={cn('grid text-right text-xs text-muted', gridRowsClass(rows))} aria-hidden>
          {hours.map((m) => <span key={m} className={cn('pr-2 -translate-y-2', rowStartClass(rowOf(m)), 'row-span-4')}>{fromMinutes(m)}</span>)}
        </div>
        {cols.map((c) => {
          // fora do expediente: complemento das janelas dentro do intervalo exibido
          const off: Array<{ s: number; e: number }> = [];
          let cur = startMin;
          for (const w of [...c.windows].sort((a, b) => a.startMin - b.startMin)) {
            if (w.startMin > cur) off.push({ s: cur, e: Math.min(w.startMin, endMin) });
            cur = Math.max(cur, w.endMin);
          }
          if (cur < endMin) off.push({ s: cur, e: endMin });
          return (
            <div key={c.key} className={cn('relative grid grid-cols-1 border-l border-border', gridRowsClass(rows))}>
              {hours.map((m) => <div key={`h${m}`} aria-hidden className={cn('border-t border-border/70', rowStartClass(rowOf(m)))} />)}
              {off.filter((o) => o.e > o.s).map((o) => (
                <div key={`o${o.s}`} aria-hidden title="Fora do expediente" className={cn('pointer-events-none bg-black/[0.07] dark:bg-white/[0.07]', rowStartClass(rowOf(o.s)), rowSpanClass(Math.ceil((o.e - o.s) / STEP)))} />
              ))}
              {c.items.map((it) => {
                const sw = swatchOf(it.color);
                const cls = cn('z-10 m-px block min-w-0 overflow-hidden rounded border-l-4 px-1.5 py-0.5 text-xs leading-tight focus:outline-2 focus:outline-offset-1',
                  rowStartClass(rowOf(Math.max(it.startMin, startMin))), rowSpanClass(Math.ceil((Math.min(it.endMin, endMin) - Math.max(it.startMin, startMin)) / STEP)),
                  it.kind === 'block' ? 'border-slate-500 bg-slate-200 text-slate-900 dark:bg-slate-800 dark:text-slate-100' : sw.block, it.status === 'cancelled' && 'line-through opacity-50');
                const body = (<><span className="block truncate font-medium">{fromMinutes(it.startMin)} · {it.title}</span><span className="block truncate">{it.sub}</span></>);
                return it.href ? <Link key={it.id} href={it.href} className={cls} aria-label={`${fromMinutes(it.startMin)} ${it.title}, ${it.sub}`}>{body}</Link> : <div key={it.id} className={cls}>{body}</div>;
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
