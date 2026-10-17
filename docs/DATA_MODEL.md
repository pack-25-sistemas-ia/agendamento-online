# DATA_MODEL — Agendamento Online

Toda tabela de negócio tem `organization_id` e RLS. Relações usam **chave composta `(id, organization_id)`**: nenhum registro aponta para outra empresa. Escrita só por RPCs `ag_*`; os papéis `anon`/`authenticated` não têm INSERT/UPDATE/DELETE em tabela.

| Tabela | Conteúdo | Pontos de integridade |
|---|---|---|
| `scheduling_settings` | Uma linha por empresa: fuso IANA, página pública ativa, nome exibido, logotipo, cor, descrição, contato, antecedência mínima, horizonte, passo, prazos de cancelamento/reagendamento, política | Faixas validadas por `check` (ex.: passo ∈ {5,10,15,20,30,60}). Convive com o `organization_settings` do Core (tema do painel); aqui ficam as políticas de agendamento |
| `professionals` | Nome, apresentação pública, cor na agenda, ativo, `linked_user_id` (login do profissional) | Cor `#rrggbb`; vínculo de usuário só pelo proprietário |
| `services` | Nome, descrição, duração, intervalo antes/depois, preço de referência (centavos), ativo, público | Duração 5–720 min; preço só informativo |
| `professional_services` | Quem faz o quê | Chave composta com profissional e serviço da mesma empresa |
| `availability_rules` | Janelas semanais (`weekday` 0–6, início/fim locais), `start_min/end_min` gerados | Exclusão GiST: janelas do mesmo dia não se sobrepõem; `start < end` |
| `availability_overrides` | Exceção por data: substitui o dia; sem horários = dia fechado | Gatilho adiado confere reservas já marcadas |
| `customers` | Nome, e-mail, telefone, `anonymized_at` | Contato validado; anonimização apaga os dados pessoais mantendo o histórico |
| `schedule_entries` | **Ocupação** de cada atendimento/bloqueio: `[occupied_start_at, occupied_end_at)`, `kind`, `active` | `schedule_entries_no_overlap`: exclusão GiST por profissional, apenas `active`; cancelar desativa e libera o horário |
| `appointments` | Atendimento: cliente, serviço, profissional, início/fim, `status`, origem, **snapshots** de nome/duração/intervalos/preço, notas, motivo de cancelamento | Status ∈ {scheduled, confirmed, completed, no_show, cancelled}; transições por função; snapshots imutáveis |
| `appointment_events` | Histórico: criada, confirmada, reagendada, cancelada, concluída, não compareceu, notas, novo link, anonimização | Só metadados seguros; sem texto livre do cliente |
| `booking_management_tokens` | **Hash** (sha256) do token do link, validade (fim do atendimento + 30 dias), revogação | O texto do token nunca é guardado |
| `public_booking_requests` | Chave de idempotência + hash do conteúdo + reserva criada | Reenvio igual devolve a mesma reserva; conteúdo diferente com a mesma chave é recusado; expira |
| `booking_rate_limits` | Contadores por balde e janela (limite de abuso no banco) | Limpeza oportunista |

Também usados do Core: `organizations`, `organization_members`, `audit_log` (ações administrativas e exportações, sem PII).

## Armazenamento
Bucket público `ag-logos` (512 KB; png/jpeg/webp; SVG recusado). O caminho contém o id da empresa e **não** vai ao navegador: a rota `/agendar/<slug>/logo` serve o arquivo.

## Perfis (derivados do papel no Core)
| Perfil | Origem | Acesso |
|---|---|---|
| Proprietário | owner/admin | Tudo, inclusive marca, configurações, pessoas e vínculo de login do profissional |
| Gestor/recepção | manager | Agenda, atendimentos, clientes, profissionais, serviços e disponibilidade; sem marca nem configurações |
| Profissional | member vinculado a um profissional ativo | Só a própria agenda e os clientes dos próprios atendimentos; pode concluir/registrar não comparecimento dos seus |
| Sem acesso | viewer / member sem vínculo | Nada |

## Migrações (ordem)
`000000_ag_schema` · `000050_ag_access` · `000100_ag_guards` · `000200_ag_registry` · `000300_ag_engine` · `000400_ag_appointments` · `000500_ag_public` · `000700_ag_storage` · `999999_ag_privileges` (sempre a última: revoga e concede EXECUTE e marca as portas públicas).
