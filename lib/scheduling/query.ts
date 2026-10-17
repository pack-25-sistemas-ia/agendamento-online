// Filtros vindos da URL (a URL é a fonte: compartilhável e funciona sem JavaScript). Tudo validado; valor inválido cai no padrão.
export type SearchParams = Record<string, string | string[] | undefined>;
export const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const uuidOrNull = (v: string | undefined): string | null => (v && UUID.test(v) ? v.toLowerCase() : null);
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

export const PAGE_SIZE = 25;
export function pageFrom(v: string | undefined): number {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 10000 ? n : 1;
}

/** Texto de busca seguro: remove curingas e separadores do PostgREST. */
export function safeSearch(v: string | undefined): string | null {
  const s = (v ?? '').replace(/[%_,()*\\.:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  return s.length >= 2 ? s : null;
}

export function withParams(base: string, current: SearchParams, changes: Record<string, string | null>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(current)) {
    const val = one(v);
    if (val !== undefined && val !== '' && !(k in changes)) q.set(k, val);
  }
  for (const [k, v] of Object.entries(changes)) if (v !== null && v !== '') q.set(k, v);
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}

export const isIsoDate = (v: string | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
