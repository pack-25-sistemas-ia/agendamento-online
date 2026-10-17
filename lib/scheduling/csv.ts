// CSV seguro: separador «;» (Excel pt-BR), UTF-8 com BOM, CRLF e proteção contra injeção de fórmulas (CSV injection).

/** Células que começam com = + - @ ou controle viram texto (prefixo apóstrofo). Aspas, «;» e quebras são escapados. */
export function csvText(v: string): string {
  const s = v.replace(/\r?\n/g, ' ');
  const danger = /^[=+\-@\t\r]/.test(s);
  const safe = danger ? `'${s}` : s;
  return /[";\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export type Col = { key: string; label: string; kind: 'text' | 'int' };
export type Row = Record<string, string | number | null | undefined>;

export function toCsv(cols: Col[], rows: Row[]): string {
  const head = cols.map((c) => csvText(c.label)).join(';');
  const body = rows.map((r) => cols.map((c) => {
    const v = r[c.key];
    if (v === null || v === undefined || v === '') return '';
    if (c.kind === 'int') return String(Math.trunc(Number(v)));
    return csvText(String(v));
  }).join(';'));
  return `﻿${[head, ...body].join('\r\n')}\r\n`;
}
