# FEATURES — Agendamento Online
Status: VERIFIED = existe e tem evidência (arquivo/teste). O que não foi feito está em «Fora do escopo», não como pendência.

| Fluxo | Status | Evidência |
|---|---|---|
| Profissionais (cadastro, cor, apresentação, vínculo com usuário e serviços) | VERIFIED | `app/(app)/profissionais`, `supabase/tests/50_ag_domain.sql`, `tests/e2e/ag-flow.spec.ts` |
| Serviços (duração, intervalos, preço de referência, público/só equipe) | VERIFIED | `app/(app)/servicos`, `50_ag_domain.sql`, `ag-flow.spec.ts` |
| Disponibilidade semanal, exceção por data e bloqueios | VERIFIED | `app/(app)/disponibilidade`, `50_ag_domain.sql`, `engine-slots.test.ts`, `ag-demo.spec.ts` (bloqueio) |
| Motor de horários (duração, intervalos, passo, antecedência, horizonte, fuso/DST) | VERIFIED | `engine-time/slots/boundaries.test.ts`, `55_ag_time_dashboard.sql` (mesmos valores) |
| Anti-conflito e concorrência | VERIFIED | `scripts/test-concurrency.mjs`, exclusão `schedule_entries_no_overlap` |
| Reserva pública sem conta, com consentimento e idempotência | VERIFIED | `60_ag_public.sql`, `ag-flow.spec.ts`, `ag-security.spec.ts` |
| Link seguro: ver, reagendar (atômico) e cancelar | VERIFIED | `60_ag_public.sql`, `ag-flow.spec.ts` |
| Agenda administrativa (dia, semana, lista), reserva manual, reagendamento | VERIFIED | `ag-demo.spec.ts` |
| Ciclo de vida (confirmar, concluir, não compareceu, cancelar) e histórico | VERIFIED | `engine-status.test.ts`, `50_ag_domain.sql`, `ag-flow.spec.ts` |
| Perfil profissional (só os próprios atendimentos) | VERIFIED | `70_ag_security.sql`, `ag-demo.spec.ts` |
| Painel com dados reais | VERIFIED | `55_ag_time_dashboard.sql`, `ag-demo.spec.ts` (painel × API) |
| Exportação CSV segura (fórmulas neutralizadas, auditada) | VERIFIED | `lib/scheduling/csv.ts`, `ag-demo.spec.ts` |
| Marca: nome, cor, logotipo, textos e política | VERIFIED | `ag-demo.spec.ts` (logotipo, página pública) |
| LGPD: anonimização de cliente e auditoria | VERIFIED | `ag-demo.spec.ts`, `50_ag_domain.sql` |
| Segurança (RLS, anon, headers, XSS, limite de abuso) | VERIFIED | `70_ag_security.sql`, `ag-security.spec.ts` |
| Responsivo e acessibilidade básica (375/768/1440) | VERIFIED | `ag-responsive.spec.ts` |
| Seed de demonstração coerente | VERIFIED | `supabase/seed-demo.sql`, `scripts/seed-demo.mjs` (confere a coerência ao carregar) |

## Fora do escopo (decisão de produto)
Pagamento, videochamada, lembretes automáticos por e-mail/WhatsApp/SMS, sincronização de calendários externos, lista de espera, recorrência/pacotes, arrastar-e-soltar na agenda.
