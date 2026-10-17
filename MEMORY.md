# MEMORY — AGENDAMENTO ONLINE
Atualizado em: 2026-10-17 | Versão: 1.0.0 | Estado: VALIDADO

## Missão do sistema
Agenda com disponibilidade real: reserva pública sem conta, agenda administrativa, bloqueios, remarcação/cancelamento pelo cliente por link seguro e impedimento de conflito no próprio banco. Público: clínicas, salões e prestadores com agenda. Risco LGPD: médio (nome, telefone, e-mail, horários).

## Stack e caminhos-chave
Next.js 16 (App Router) + React 19 + TypeScript strict + Tailwind 4 + Supabase (Auth, PostgreSQL, Storage). Banco: `supabase/migrations/20271101*` (escrita só por RPCs `ag_*`, RLS só leitura, 8 portas públicas `ag_public_*`). Domínio TS: `lib/scheduling` (tempo, horários, estados, CSV, token). UI: `app/(app)/*`, `app/agendar`, `app/reserva`, `components/ag`. Testes: `tests/unit`, `tests/e2e`, `supabase/tests`, `scripts/test-*.mjs`, `scripts/mutation-check.mjs`. Skills: `.agents/skills/*`.
Comandos: `pnpm lint | typecheck | test | build | test:db | test:concurrency | test:mutation | test:e2e` (E2E na porta 3125, ver docs/DEPLOYMENT.md).

## Implementado e verificado (2026-10-17, com evidência)
- Profissionais, serviços, disponibilidade semanal/exceção/bloqueios, motor de horários (duração, intervalos, passo, antecedência, horizonte, fuso/DST), anti-conflito (exclusão GiST + trava por profissional), reserva pública idempotente, link seguro (ver/reagendar/cancelar), agenda dia/semana/lista, reserva manual, ciclo de vida, painel, CSV, marca e logotipo, LGPD (anonimização), seed de demonstração coerente.
- `pnpm lint` e `pnpm typecheck`: sem erros. `pnpm test`: 7 arquivos, 85 testes. `pnpm build`: ok.
- `pnpm test:db` (Core + sistema): todos passam — `50_ag_domain` (14 blocos), `55_ag_time_dashboard` (3), `60_ag_public` (13), `65_ag_engine_rules` (10), `70_ag_security` (5).
- `pnpm test:concurrency`: passa em 3 execuções seguidas (mesma reserva ×8, reserva × bloqueio, remarcações, duplo envio público, 6 clientes públicos no mesmo horário, cancelar × reagendar, bloqueio e mudança de disponibilidade que seguram a reserva).
- E2E (Playwright, app compilado, banco recriado antes de cada arquivo): core-flow 5, email-flows 3, security 5, ag-flow 8, ag-demo 9, ag-security 7, ag-responsive 5 — **42 passam**.
- `pnpm test:mutation`: **109/109 mutações reprovadas** (52 no motor TS e 57 em banco e concorrência; 1 mutação equivalente foi removida: `hourCycle: 'h23'` nunca devolve hora 24). As baselines `db` e `conc` passaram no mesmo run.
- Revisão visual desktop (1440) e celular (375) feita em capturas da agenda, painel e página pública; `ag-responsive` falha em rolagem horizontal, h1 duplicado ou campo sem nome.

## Em implementação
- Nada.

## Pendências e riscos
- Lembretes automáticos (e-mail/WhatsApp), calendários externos, lista de espera e arrastar-e-soltar estão **fora do escopo** do MVP (decisão D-A17).
- Rate limit em memória é por instância; o limite no banco vale em qualquer instância. Sem CAPTCHA no MVP.
- Comprador precisa do próprio Supabase (região Brasil), SMTP, `BOOKING_TOKEN_SECRET`, MFA e hospedagem (docs/DEPLOYMENT.md).

## Decisões relevantes
Ver docs/DECISIONS.md. Principais: banco é a fonte de verdade da disponibilidade (D-A1); ocupação unificada (D-A2); trava por profissional (D-A4); política de horário de verão (D-A5); token HMAC com segredo do servidor (D-A8); cancelar não revoga o link (D-A9); sem biblioteca de calendário nem date-fns (D-A10/11); CSP sem `style=""` (D-A12); `recharts` removido por não ser usado.

## Testes executados
Ver «Implementado e verificado». Mutação: 12 sobreviventes na 1ª rodada do banco viraram testes diretos (`supabase/tests/65_ag_engine_rules.sql`) e 6 no motor TS viraram `tests/unit/engine-boundaries.test.ts`; nova rodada completa: 109/109.

## Armadilhas (para não repetir)
- `next build` também tipa `tests/`; `'use server'` só exporta funções assíncronas; render-prop não atravessa Server→Client (use contexto); lint proíbe `setState` em effect.
- `SET CONSTRAINTS ALL IMMEDIATE` persiste na transação; gatilhos adiados carregam a versão antiga da linha (releia o estado) e precisam ser SECURITY DEFINER; testes SQL com rollback escondem gatilhos adiados.
- O teste do Core `20_profiles.sql` exige o comentário `PUBLIC_ENDPOINT:` em toda função SECURITY DEFINER executável por anon (feito em `999999_ag_privileges`).
- O spec do Core espera um h1 contendo «Painel» no `/dashboard` e 404 do servidor em `/settings`, `/audit`, `/privacy` para o leitor.
- Teste de concorrência por tempo absoluto é frágil: use margem (segurador 4 s, espera 1,2 s, limite 1,5 s).
- Seed: use hash separado para decidir inserção e status (senão nunca há cancelados/faltas).
- Agenda cheia no seed: testes E2E que reservam devem procurar uma data com horários livres, não presumir «hoje + N».

## Próxima tarefa recomendada
1. Se o comprador quiser lembretes, adicionar um provedor de e-mail/WhatsApp com consentimento específico e fila (docs/DECISIONS.md D-A17).
2. Opcional: CAPTCHA na página pública (docs/SECURITY.md).

## Referências
docs/FEATURES.md · docs/DATA_MODEL.md · docs/ARCHITECTURE.md · docs/DECISIONS.md · docs/REFERENCES.md · docs/SECURITY.md · docs/DEPLOYMENT.md
