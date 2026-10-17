# DEPLOYMENT — Agendamento Online

Tudo é seu: seu projeto Supabase, seu repositório, sua hospedagem. Nada é enviado ao autor do Pack.

## Pré-requisitos
Node 22+, pnpm 12, Docker (Supabase local e `pnpm test:db`), conta Supabase com região **São Paulo** (dados pessoais), hospedagem Node (ex.: Vercel).

## Variáveis (`.env.local`, nunca no git)
| Variável | Valor |
|---|---|
| `NEXT_PUBLIC_APP_URL` | URL pública do app (usada no link da página de reservas) |
| `NEXT_PUBLIC_SUPABASE_URL` | URL do seu projeto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | chave publishable/anon (segura no navegador, limitada pelo RLS e pelos privilégios das funções) |
| `BOOKING_TOKEN_SECRET` | **segredo do servidor**, mínimo 32 caracteres, único por ambiente. Gere com `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`. Sem ele a reserva pública não funciona |

O app **não usa** `service_role`. Não a coloque em variável alguma. `BOOKING_TOKEN_SECRET` nunca tem o prefixo `NEXT_PUBLIC_`.

## Banco
1. **Local**: `supabase start` e `supabase db reset` (migrações). Portas 588xx (`project_id = pack25-agendamento-online`). Para dados de demonstração: `node scripts/seed-demo.mjs`.
2. **Produção**: `supabase link --project-ref <ref>` e `supabase db push`. **Não** rode `seed-demo.mjs` (cria usuários e atendimentos fictícios).
3. **Autenticação**: confirmação de e-mail ligada, senha mínima de 12, **TOTP (MFA) habilitado** (as RPCs de escrita exigem a 2ª etapa), SMTP próprio, URL do app em Redirect URLs.
4. **Storage**: o bucket `ag-logos` (público, 512 KB, png/jpeg/webp) é criado pela migração `000700`. O caminho do arquivo nunca vai ao navegador; a rota `/agendar/<slug>/logo` o serve.
5. **Backup e restauração**: backups diários do Supabase (PITR em plano pago). Restaure o banco inteiro, nunca «linhas»: agenda, ocupação e histórico dependem uns dos outros. Teste a restauração num projeto separado antes de precisar dela. Os logotipos ficam no Storage: inclua-os no seu procedimento de cópia.
6. **Reversão**: migrações só para frente; para voltar, restaure o backup.

## Aplicação
`pnpm install --frozen-lockfile` → `pnpm lint && pnpm typecheck && pnpm test && pnpm build` → `pnpm start`. Hospedagem serverless: configure as variáveis acima no painel do provedor.

## Primeiro uso em produção
1. Entrar como proprietário (ativar o 2º fator). 2. **Configurações**: fuso, passo, antecedência, horizonte e prazos. 3. **Serviços** e **Profissionais** (vincule serviços; vincule o login do profissional, se houver). 4. **Disponibilidade**: janelas semanais, exceções e bloqueios. 5. **Página de reservas**: marca, política, **ativar** e copiar o link. 6. Faça uma reserva de teste pelo link e cancele-a.

## Custos externos
| Item | Observação |
|---|---|
| Supabase | Plano gratuito serve para testar; produção recomenda plano pago (backups diários/PITR, sem pausa por inatividade) |
| Hospedagem Node | Vercel/Render/etc.; há opções gratuitas com limites |
| SMTP (e-mail transacional) | Necessário para confirmar cadastro e recuperar senha da equipe; o sistema **não** envia e-mail ao cliente final |
| Domínio | Opcional, mas recomendado para o link público |

## Testes locais
- Unitários: `pnpm test` · SQL: `pnpm test:db` (inclui os testes do Core) · concorrência: `pnpm test:concurrency` · mutação: `pnpm test:mutation` (demorado; roda sozinho).
- **E2E**: `pnpm test:e2e` usa o Supabase local e o app **compilado** (`pnpm build && pnpm start -p 3125`). Copie URLs/chaves de `supabase status` para `.env.e2e` (`E2E_SUPABASE_URL`, `E2E_SUPABASE_ANON_KEY`, `E2E_BASE_URL`, `E2E_MAILPIT_URL`) e o mesmo `BOOKING_TOKEN_SECRET`. Rode **um arquivo por vez**, reiniciando o app entre eles (limitador em memória) e **depois de `supabase db reset` + `node scripts/seed-demo.mjs`** (os fluxos alteram dados e os testes `ag-*` leem a senha da demonstração em `node_modules/.cache`).

## Dados de demonstração
Empresa «Estúdio Aurora (demonstração)» (`/agendar/estudio-aurora`), 3 profissionais, 5 serviços, 14 clientes fictícios e uma agenda coerente de −14 a +10 dias. Usuários `dono@`, `recepcao@`, `ana@`, `carlos@`, `diana@` (`@demo.exemplo`) com **senha aleatória por execução** em `node_modules/.cache/ag-demo-credentials.json`.

## Checklist de produção
- [ ] Região Brasil; backups ligados; MFA ligado; SMTP próprio; Redirect URLs.
- [ ] `seed-demo.mjs` **não** executado; nenhuma chave `service_role` em variável de ambiente.
- [ ] `BOOKING_TOKEN_SECRET` definido (≥ 32 caracteres) e guardado em cofre.
- [ ] Fuso e prazos revisados; página de reservas testada pelo celular.
- [ ] Revisar o aviso de privacidade e o texto de consentimento com seu jurídico (controlador = quem implanta; dados: nome, telefone, e-mail e horários).
