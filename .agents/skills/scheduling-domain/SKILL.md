---
name: scheduling-domain
description: Use ao mexer em profissionais, serviços, atendimentos, estados ou no modelo de agenda.
---

# scheduling-domain

- Modelo: `professionals` × `services` (via `professional_services`), `availability_rules/overrides`, `schedule_entries` (ocupação) e `appointments` (atendimento + **snapshots** do serviço). Veja `docs/DATA_MODEL.md`.
- Estados: `scheduled → confirmed → completed | no_show | cancelled` (cancelar também a partir de `scheduled`). Estados finais não voltam. Concluir/registrar não comparecimento só depois do início. Regras em `lib/scheduling/status.ts` **e** `private.ag_transition`.
- Taxa de não comparecimento = no_show / (completed + no_show); sem dados é `null` («Sem dados»), nunca 0%.
- Editar serviço vale só para novas reservas; nunca reescreva snapshots.
- Teste: `tests/unit/engine-status.test.ts`, `supabase/tests/50_ag_domain.sql`.
