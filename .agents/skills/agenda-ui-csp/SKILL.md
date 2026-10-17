---
name: agenda-ui-csp
description: Use ao alterar a agenda (grade), cores, gráficos ou qualquer estilo dinâmico.
---

# agenda-ui-csp

- A CSP não permite `style=""`. Posição/altura dos eventos usam **classes estáticas** geradas por `node scripts/gen-grid-classes.mjs` (`lib/scheduling/grid-classes.ts`); cores só da paleta fixa (`lib/scheduling/palette.ts`).
- Server Components não recebem função como `children`: formulários usam contexto (`AgForm` em `components/ag/fields.tsx`).
- `'use server'` só exporta funções assíncronas; constantes ficam em outro módulo.
- Lint `react-hooks` proíbe `setState` em effect: use o wrapper `useAgAction`.
- Revise sempre em 375 px e 1440 px; `tests/e2e/ag-responsive.spec.ts` falha se houver rolagem horizontal, h1 duplicado ou campo sem nome.
