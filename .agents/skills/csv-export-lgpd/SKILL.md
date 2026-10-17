---
name: csv-export-lgpd
description: Use ao exportar dados, anonimizar clientes ou registrar auditoria.
---

# csv-export-lgpd

- CSV via `lib/scheduling/csv.ts`: separador `;`, UTF-8 com BOM, CRLF; células iniciadas por `= + - @` ou controle ganham apóstrofo. A rota `/api/exportar/agendamentos` exige sessão e perfil, e chama `ag_log_export` (auditoria sem PII).
- Exporte só as colunas necessárias. Profissional exporta apenas o que enxerga.
- Anonimizar cliente apaga nome, e-mail e telefone, revoga links e registra o evento, preservando o histórico.
- Nunca logue nome, telefone, e-mail nem token.
- Teste: `ag-demo.spec.ts` (CSV e LGPD), mutantes `exportação:` em `scripts/mutation-check.mjs`.
