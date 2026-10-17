---
name: availability-engine
description: Use ao alterar cálculo de horários livres, janelas, exceções, bloqueios, passo, antecedência ou horizonte.
---

# availability-engine

- **Fonte de verdade = SQL** (`private.ag_windows`, `ag_check_slot`, `ag_list_slots`). O espelho `lib/scheduling/slots.ts` deve dar os mesmos resultados; mude os dois e os testes com **os mesmos valores** (`engine-slots/boundaries.test.ts` × `50_ag_domain.sql`, `55_ag_time_dashboard.sql`).
- Regras: exceção por data **substitui** o dia (sem horários = fechado); bloqueios e atendimentos ativos subtraem; a ocupação `[início − antes, fim + depois)` cabe **inteira** na janela; o passo só define a grade de inícios (público); intervalo semiaberto, adjacência permitida.
- Público: aplica antecedência mínima, horizonte (último dia aberto = hoje + N, inclusive) e a grade. Administrativo: qualquer minuto livre dentro da janela.
- Ordem de verificação (mesmos motivos): past → notice → horizon → outside → conflict.
- Depois de mudar regra: `pnpm test` e `pnpm test:db`; rode `pnpm test:mutation --only "horário"`.
