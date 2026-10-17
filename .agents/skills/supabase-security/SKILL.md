---
name: supabase-security
description: Use ao criar tabela, política, RPC, bucket ou privilégio.
---

# supabase-security

- `organization_id` + FK composta `(id, organization_id)`; RLS só SELECT; escrita por RPC `ag_*` SECURITY DEFINER com `search_path` vazio, validando sessão, MFA e perfil (`private.ag_guard`).
- Privilégios são fechados na **última** migração (`999999_ag_privileges`): `public.ag_*` só `authenticated`; `ag_public_*` também `anon` e com comentário `PUBLIC_ENDPOINT:` (o teste do Core `20_profiles.sql` exige); `private.ag_*` ninguém, salvo auxiliares de RLS. Função nova em `private` que a RLS use precisa entrar na lista.
- Funções SECURITY DEFINER executadas por anon não podem ler tabelas por acidente: valide entradas, devolva o mínimo.
- Nunca desligar RLS. Sem `service_role` no app. Trigger de constraint adiado = SECURITY DEFINER.
- Testes: `supabase/tests/70_ag_security.sql`, `tests/e2e/ag-security.spec.ts`.
