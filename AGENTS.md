# AGENTS — Agendamento Online

Sistema 11 do Pack 25 Sistemas IA (agendamento-online). O status real vive em MEMORY.md.

## Regras perenes
- Esta pasta é autossuficiente: nada importa de fora dela, sem workspace:*, sem citar outros sistemas.
- Ler MEMORY.md antes de trabalhar; atualizar ao concluir marcos, só com fatos comprovados.
- Toda tabela de negócio tem organization_id + RLS (nunca desabilitar); toda escrita passa por RPC `ag_*` (SECURITY DEFINER, search_path fixo) e valida sessão, papel e entrada no servidor. O público só alcança as 8 funções `ag_public_*`.
- **O banco é a fonte de verdade da disponibilidade** (`ag_check_slot` / `ag_list_slots` + exclusão `schedule_entries_no_overlap`). O espelho TS (`lib/scheduling/slots.ts`) só explica e sombreia a agenda: mudou uma regra, mude os dois e os testes com os mesmos valores.
- Token do link de gerenciamento: HMAC com `BOOKING_TOKEN_SECRET`; só o hash vai ao banco; `/reserva/*` nunca envia Referer, não é indexada nem fica em cache. Cancelar NÃO revoga o link (o cliente continua vendo «Cancelada»).
- CSP estrita: **sem `style=""`**. Posições da agenda usam classes estáticas (`scripts/gen-grid-classes.mjs`); cores só da paleta fixa (`lib/scheduling/palette.ts`).
- Nunca commitar segredos; o sistema não usa service_role. Dados pessoais mínimos; sem PII em logs; seed só com nomes fictícios (`@demo.exemplo`) e senha aleatória.
- Não declarar pronto sem evidência (comando + resultado). Se algo não foi executado, escrever NÃO EXECUTADO.

## Comandos
pnpm install --frozen-lockfile · pnpm lint · pnpm typecheck · pnpm test · pnpm build · pnpm test:db · pnpm test:concurrency · pnpm test:mutation · pnpm test:e2e
(E2E: app compilado na porta 3125, `supabase db reset` + `node scripts/seed-demo.mjs` antes, um arquivo por vez — ver docs/DEPLOYMENT.md.)

## Mapa
`lib/scheduling` (tempo, horários, estados, CSV, token) · `lib/scheduling/actions` (ações do servidor) · `components/ag` · `app/(app)/*` (rotas em português) · `app/agendar`, `app/reserva` (públicas) · `supabase/migrations/20271101*` · `supabase/tests` · `scripts` · `.agents/skills/*`.

## Definição de pronto (resumo)
Migrações em banco limpo, seed reproduzível, teste RLS A/B negando acesso cruzado, fluxos críticos em Playwright,
mobile e desktop revisados, licenças e segredos verificados, instalação isolada validada, docs e MEMORY.md atualizados.
