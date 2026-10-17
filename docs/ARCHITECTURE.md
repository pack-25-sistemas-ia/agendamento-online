# ARCHITECTURE — Agendamento Online

## Visão geral
Next.js 16 (App Router, React 19, TypeScript strict, Tailwind 4) sobre Supabase (Auth, PostgreSQL, Storage). O app não usa `service_role`: o painel fala com o banco **como o usuário logado** (RLS + RPCs) e a parte pública fala **como anon**, só com 8 funções.

```
Navegador ── /agendar/<slug>, /reserva/<token> ──▶ Server Components/Actions ──▶ cliente anon ──▶ public.ag_public_* (8)
Navegador ── painel (sessão + MFA) ───────────────▶ Server Components/Actions ──▶ cliente do usuário ──▶ SELECT (RLS) + public.ag_* (escrita)
                                                                                  └─ private.ag_* (regras; ninguém chama direto)
```

## Camadas
| Camada | Onde | Papel |
|---|---|---|
| Regras e integridade | `supabase/migrations/20271101*` | Fonte de verdade: horários (`ag_check_slot`, `ag_list_slots`), exclusão de sobreposição, transições, tokens, limite de abuso, auditoria |
| Leitura | RLS (`000050_ag_access`) | Somente SELECT por perfil; sem política de escrita |
| Escrita | RPCs `public.ag_*` | SECURITY DEFINER, `search_path` fixo, validam sessão, MFA, perfil e entrada |
| Público | RPCs `public.ag_public_*` | Únicas concedidas a `anon`, marcadas `PUBLIC_ENDPOINT` |
| Espelho TS | `lib/scheduling/{time,slots,status}.ts` | Explica/sombreia a agenda e testa as regras em exemplos legíveis; **nunca grava** |
| Ações | `lib/scheduling/actions/*` | Validação (Zod), chamada da RPC, mensagem amigável, `revalidatePath` |
| UI | `app/*`, `components/ag/*` | Server Components; formulários por contexto (`AgForm`); agenda em grade com classes estáticas |

## Como o conflito é impedido
1. `schedule_entries` guarda a **ocupação** `[início − intervalo antes, fim + intervalo depois)` de cada atendimento e de cada bloqueio, com `active`.
2. A restrição `schedule_entries_no_overlap` (GiST sobre profissional + `tstzrange` semiaberto, `where active`) impede duas ocupações ativas sobrepostas, mesmo sob concorrência.
3. Antes de validar, toda operação que muda a agenda toma o **advisory lock do profissional** (`private.ag_lock`). Assim bloqueio, mudança de disponibilidade e reserva se serializam: a reserva espera e é validada **depois**.
4. Gatilhos adiados (`appointment_consistency`, `entry_consistency`, `override_consistency`) conferem o estado final no COMMIT: ocupação acompanha o status; reservas ativas cabem na disponibilidade.
5. Reagendar é uma transação: valida o novo horário (ignorando a própria ocupação), move, registra o evento. Se falhar, o original permanece.

## Fluxo público
`/agendar/<slug>` (RSC) → `ag_public_page` → cliente escolhe → `ag_public_slots` → envia formulário (Server Action): limite por IP (em memória) → chave de idempotência (UUID) → token = HMAC(chave) → `ag_public_book` (limites no banco, consentimento, validação, reserva atômica, hash do token) → redireciona a `/reserva/<token>`.

## Tempo e fuso
Instantes em `timestamptz`/ms UTC; janelas semanais em hora local da empresa (`scheduling_settings.timezone`, IANA). Conversão em TS com `Intl` (sem biblioteca) e em SQL com `AT TIME ZONE`. Política de horário de verão em `docs/DECISIONS.md` (D-A5).

## Segurança e cabeçalhos
CSP estrita por requisição (nonce), `/reserva/*` com `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex` e `Cache-Control: private, no-store`. Detalhes em `docs/SECURITY.md`.

## Estrutura de pastas
`app/(app)/*` painel · `app/agendar/[slug]` e `app/reserva/[token]` público · `app/api/exportar/agendamentos` CSV · `lib/scheduling` domínio · `components/ag` · `supabase/migrations`, `supabase/tests`, `seed-demo.sql` · `scripts` (seed, testes de banco/concorrência/mutação, geração das classes da grade).
