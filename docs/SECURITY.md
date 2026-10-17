# SECURITY — Agendamento Online

## Superfície pública
O público (sem sessão) alcança **somente** 8 funções SQL, concedidas a `anon` e marcadas `PUBLIC_ENDPOINT`: `ag_public_page`, `ag_public_logo_path`, `ag_public_slots`, `ag_public_book`, `ag_public_get_booking`, `ag_public_cancel`, `ag_public_booking_slots`, `ag_public_reschedule`. Tabelas: `anon` não lê nem escreve em nenhuma (testado). Funções `private.*` não são executáveis por ninguém, exceto auxiliares de RLS para usuários autenticados.

## Link de gerenciamento da reserva
- Token de 256 bits derivado por HMAC-SHA256 com `BOOKING_TOKEN_SECRET`; o banco guarda **só o hash**.
- Formato validado (40–128 caracteres base64url) antes de qualquer consulta; token inválido, expirado ou revogado devolve «link inválido» sem diferenciar o motivo.
- Validade: fim do atendimento + 30 dias. Reemitir o link revoga o anterior; anonimizar o cliente revoga os links.
- `/reserva/*`: `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex, nofollow`, `Cache-Control: private, no-store`. A página mostra o mínimo (serviço, profissional, data/horário, política e contato da empresa) e **não** exibe dados do cliente.
- Cancelar/reagendar respeitam os prazos configurados e usam trava de linha.

## Abuso e automação
Limite em memória por IP (instância) e **limites no banco** (`ag_rate_hit`) por empresa, por contato (6 reservas/hora) e por token. Idempotência (UUID + hash do conteúdo) impede reserva duplicada por duplo clique/reenvio. O formulário exige consentimento. Não há CAPTCHA no MVP; se houver ataque, ative Cloudflare Turnstile ou similar na hospedagem.

## Autorização
Perfis derivados do papel no Core (proprietário, gestor, profissional). Toda RPC administrativa valida sessão, **MFA (aal2)** e perfil. RLS é só de leitura; o profissional enxerga apenas a própria agenda. Testes A/B de isolamento entre empresas em `supabase/tests/70_ag_security.sql`.

## Entrada e saída
- Validação no servidor (Zod nas ações; `check` e funções no banco). Texto sempre renderizado como texto (teste de XSS com nome `<img onerror>`).
- CSV: separador `;`, UTF-8 com BOM, células iniciadas por `= + - @` ou controle recebem apóstrofo; cada exportação é auditada.
- Logotipo: tipo conferido pelos **bytes** (PNG/JPEG/WebP), até 512 KB; SVG é recusado.
- CSP com nonce por requisição, `frame-ancestors`/COOP/HSTS e demais cabeçalhos do Core.

## Dados pessoais (LGPD)
Mínimo necessário (nome, telefone/e-mail, horário). Sem PII em logs; auditoria guarda metadados. Anonimização de cliente apaga os dados pessoais e revoga links, preservando o histórico agregado. Exportação e acesso administrativo ficam na trilha de auditoria. Retenção e base legal são decisões do controlador (quem implanta).

## Segredos
`BOOKING_TOKEN_SECRET` só no servidor. O sistema não usa `service_role`. `scripts/seed-demo.mjs` gera senha aleatória e não a imprime. `.env*` fora do git.

## Verificação
`pnpm test:db` (RLS, domínio, privilégios, público, segurança) · `tests/e2e/ag-security.spec.ts` (anon, RPCs, cabeçalhos, XSS, limite, idempotência) · `pnpm test:mutation` (remove cada defesa e exige que um teste falhe).

## Reportar vulnerabilidade
Veja o `SECURITY.md` do repositório do Pack.
