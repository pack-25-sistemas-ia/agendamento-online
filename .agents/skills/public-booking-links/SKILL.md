---
name: public-booking-links
description: Use ao alterar a página pública, o formulário de reserva ou o link de gerenciamento (/agendar, /reserva).
---

# public-booking-links

- O público só chama as 8 funções `ag_public_*` (cliente anon, `lib/scheduling/public-db.ts`). Nova operação pública = nova função com a marca `PUBLIC_ENDPOINT`, limite de abuso, validação e teste em `60_ag_public.sql` + `ag-security.spec.ts`.
- Token: `deriveBookingToken(idem)` = HMAC com `BOOKING_TOKEN_SECRET` (≥ 32 caracteres, falha fechada). O banco guarda só o hash. Nunca registre o token em log nem o coloque em query string.
- `/reserva/*`: `no-referrer`, `noindex`, `no-store`. A página não mostra dados do cliente.
- Idempotência: mesma chave + mesmo conteúdo = mesma reserva (`replayed`); mesma chave + conteúdo diferente = recusa.
- Cancelar **não** revoga o link (mostra «Cancelada»); reemitir o link revoga o anterior.
- Mensagens ao cliente são amigáveis e nunca expõem SQL, nomes de restrição ou ids internos.
