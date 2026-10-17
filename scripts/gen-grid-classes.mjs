// Regenera lib/scheduling/grid-classes.ts (classes estáticas do grid da agenda). Uso: node scripts/gen-grid-classes.mjs
import { writeFileSync } from 'node:fs';
const q = (s) => `'${s}'`;
const starts = Array.from({ length: 97 }, (_, i) => q(`row-start-[${i + 1}]`)).join(', ');
const spans = Array.from({ length: 96 }, (_, i) => q(`row-span-[${i + 1}]`)).join(', ');
const cols = Array.from({ length: 8 }, (_, i) => q(`grid-cols-[3rem_repeat(${i + 1},minmax(7.5rem,1fr))]`)).join(', ');
const rows = Array.from({ length: 96 }, (_, i) => q(`grid-rows-[repeat(${i + 1},1.25rem)]`)).join(', ');
const out = `// GERADO por scripts/gen-grid-classes.mjs — NÃO editar à mão.
// A CSP estrita do app bloqueia atributos style=""; por isso a agenda posiciona os blocos com CSS Grid e classes ESTÁTICAS (o Tailwind precisa ver cada nome literal).
// Resolução: 15 minutos por linha (1,25 rem). Até 96 linhas (24 h) e 8 colunas de profissional/dia.
const ROW_START = [${starts}] as const;
const ROW_SPAN = [${spans}] as const;
const GRID_COLS = [${cols}] as const;
const GRID_ROWS = [${rows}] as const;
const clamp = (n: number, max: number): number => Math.max(1, Math.min(max, Math.round(n)));
export const rowStartClass = (n: number): string => ROW_START[clamp(n, 97) - 1]!;
export const rowSpanClass = (n: number): string => ROW_SPAN[clamp(n, 96) - 1]!;
export const gridColsClass = (n: number): string => GRID_COLS[clamp(n, 8) - 1]!;
export const gridRowsClass = (n: number): string => GRID_ROWS[clamp(n, 96) - 1]!;
`;
writeFileSync('lib/scheduling/grid-classes.ts', out);
