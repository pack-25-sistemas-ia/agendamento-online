// Paleta fixa de cores dos profissionais. A CSP estrita proíbe style="" inline, então cada cor tem classes ESTÁTICAS (o Tailwind precisa ver os nomes literais).
// O banco aceita qualquer #RRGGBB; cores fora da paleta aparecem em cinza-ardósia na agenda.
export type Swatch = { hex: string; name: string; dot: string; block: string };

export const PALETTE: readonly Swatch[] = [
  { hex: '#2563eb', name: 'Azul', dot: 'bg-blue-600', block: 'border-blue-600 bg-blue-50 text-blue-950 dark:bg-blue-950 dark:text-blue-50' },
  { hex: '#16a34a', name: 'Verde', dot: 'bg-green-600', block: 'border-green-600 bg-green-50 text-green-950 dark:bg-green-950 dark:text-green-50' },
  { hex: '#9333ea', name: 'Roxo', dot: 'bg-purple-600', block: 'border-purple-600 bg-purple-50 text-purple-950 dark:bg-purple-950 dark:text-purple-50' },
  { hex: '#be185d', name: 'Rosa', dot: 'bg-pink-700', block: 'border-pink-700 bg-pink-50 text-pink-950 dark:bg-pink-950 dark:text-pink-50' },
  { hex: '#ea580c', name: 'Laranja', dot: 'bg-orange-600', block: 'border-orange-600 bg-orange-50 text-orange-950 dark:bg-orange-950 dark:text-orange-50' },
  { hex: '#0f766e', name: 'Verde-água', dot: 'bg-teal-700', block: 'border-teal-700 bg-teal-50 text-teal-950 dark:bg-teal-950 dark:text-teal-50' },
  { hex: '#dc2626', name: 'Vermelho', dot: 'bg-red-600', block: 'border-red-600 bg-red-50 text-red-950 dark:bg-red-950 dark:text-red-50' },
  { hex: '#475569', name: 'Ardósia', dot: 'bg-slate-600', block: 'border-slate-600 bg-slate-100 text-slate-950 dark:bg-slate-900 dark:text-slate-50' },
];
const FALLBACK = PALETTE[PALETTE.length - 1]!;
export const swatchOf = (hex: string | null | undefined): Swatch => PALETTE.find((s) => s.hex === (hex ?? '').toLowerCase()) ?? FALLBACK;
