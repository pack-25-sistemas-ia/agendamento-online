# DECISIONS — Agendamento Online

**D-A1 O banco decide a disponibilidade.** `private.ag_check_slot` / `ag_list_slots` + exclusão `schedule_entries_no_overlap` são a fonte de verdade; a validação da tela é só indicativa. O espelho TypeScript (`lib/scheduling/slots.ts`) existe para sombrear a agenda e para testar as regras em exemplos legíveis, e é verificado com **os mesmos valores** dos testes SQL.

**D-A2 Ocupação unificada.** Atendimentos e bloqueios são linhas de `schedule_entries` (`kind`), disputando o mesmo espaço sob a mesma restrição de exclusão. A ocupação inclui os intervalos antes/depois do serviço, mas só o horário do atendimento aparece ao cliente.

**D-A3 Intervalos semiabertos `[início, fim)`.** Atendimentos adjacentes são permitidos; sobreposição parcial não.

**D-A4 Trava por profissional (advisory lock).** Toda operação que altera agenda ou disponibilidade serializa por profissional. Quem chega depois espera e é validado **depois**, em vez de passar por cima de uma transação em andamento (testado em `scripts/test-concurrency.mjs`). Remarcação com troca de profissional trava os dois em ordem fixa (sem deadlock).

**D-A5 Política de horário de verão.** Hora local **inexistente** (salto) é deslocada para frente; hora **ambígua** (volta) vale a ocorrência posterior (horário padrão). A janela de 01:00–05:00 num dia de salto dura 3 h reais. Idêntica em SQL (`AT TIME ZONE`) e TS (`Intl`), testada em America/New_York (14/03/2027 e 07/11/2027). O Brasil não tem horário de verão desde 2019, mas o sistema aceita qualquer fuso IANA.

**D-A6 Snapshots no atendimento.** Nome, duração, intervalos e preço do serviço são copiados na reserva. Editar o serviço depois vale só para novas reservas; remarcar mantém a duração original.

**D-A7 Escrita só por RPC `ag_*`; RLS só de leitura.** Evita que uma política de INSERT/UPDATE mal escrita abra a agenda. Funções SECURITY DEFINER com `search_path` vazio; privilégios fechados na última migração (`999999_ag_privileges`), com marca `PUBLIC_ENDPOINT` nas 8 portas públicas.

**D-A8 Token do link: HMAC com segredo do servidor.** `token = HMAC-SHA256(BOOKING_TOKEN_SECRET, "ag-booking-v1:" + chave de idempotência)` (256 bits). Reenviar o formulário devolve **o mesmo** link sem guardar o texto do token; quem lê o banco vê só o hash (sha256) e não consegue usar o link; quem vê a chave de idempotência no navegador não calcula o token. Sem o segredo (mín. 32 caracteres) a reserva pública **não funciona** (falha fechada).

**D-A9 Cancelar não revoga o link.** O cliente continua vendo a reserva como «Cancelada», sem ações (evita um 404 confuso). O link expira 30 dias após o fim do atendimento ou é revogado ao anonimizar o cliente ou reemitir o link.

**D-A10 Sem biblioteca de calendário.** Fuso fixo da empresa, CSP sem `style=""` e necessidades simples (dia, semana, lista) tornam uma biblioteca um custo sem ganho. Ver `docs/REFERENCES.md`.

**D-A11 Sem date-fns.** O que se precisa (somar dias, fuso, formatação pt-BR) cabe em `lib/scheduling/time.ts` sobre `Intl`, com testes de fuso.

**D-A12 CSP estrita na agenda.** Posições da grade vêm de classes estáticas geradas (`scripts/gen-grid-classes.mjs`) e as cores de uma paleta fixa; nenhum estilo inline.

**D-A13 Limite de abuso em duas camadas.** Em memória por IP (barato, por instância) **e** no banco por empresa, contato e token (`ag_rate_hit`, vale em qualquer instância). Uma tentativa recusada por outro motivo desfaz o próprio contador (a transação inteira é revertida), então só reservas aceitas consomem o teto por contato.

**D-A14 Slug e pasta.** O sistema vive em `sistemas/11-agendamento-online` e o repositório público é `agendamento-online` (o prompt original citava outro nome de pasta). O catálogo registra o id 11 com o slug `agendamento-online`.

**D-A15 `scheduling_settings` ao lado do Core.** O Core já tem `organization_settings` (tema do painel). As políticas de agendamento ficam em tabela própria para não misturar nem exigir mudança no Core.

**D-A16 Seed sem credencial fixa.** `seed.sql` fica vazio (só comentário); `seed-demo.mjs` cria os usuários de demonstração com senha aleatória e confere a coerência da agenda (sem sobreposição, serviços compatíveis, estados coerentes com a data).

**D-A17 Lembretes automáticos fora do MVP.** Exigem provedor de e-mail/WhatsApp, consentimento específico e fila; a equipe reemite o link e copia a mensagem. Registrado como evolução.
