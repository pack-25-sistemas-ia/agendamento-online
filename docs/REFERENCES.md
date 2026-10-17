# REFERENCES — Agendamento Online

Avaliação de referências **antes** do código. Consulta em **2026-10-17** (estrelas, versão e licença observadas nas páginas dos projetos nessa data). Estrelas são sinal complementar, não critério técnico. Nenhum código de terceiros foi copiado.

| Projeto | URL | Estrelas | Versão avaliada | Licença | Uso pretendido | Restrições | Decisão |
|---|---|---|---|---|---|---|---|
| Schedule-X | https://github.com/schedule-x/schedule-x | 2.603 | calendar 4.9.1 | MIT (pacotes `calendar`, `theme-default`); **recursos premium são pacotes separados com licença comercial** | Agenda dia/semana/mês | Visões e recursos avançados (ex.: arrastar, recorrência) exigem plugin premium; interface em inglês por padrão | **Não adotado** |
| react-big-calendar | https://github.com/jquense/react-big-calendar | 8.764 | 1.20.0 | MIT | Agenda dia/semana/mês | Estilo próprio via CSS (entra em conflito com CSP sem `style=""`: posiciona eventos com estilo inline); localização exige configuração | **Não adotado** |
| FullCalendar | https://github.com/fullcalendar/fullcalendar | 20.693 | v7.1.3 | MIT no núcleo e visões básicas; **visões de linha do tempo/recursos (Scheduler) são comerciais** | Agenda | Peso alto; estilo inline para posicionar eventos; recursos por profissional (a visão natural deste sistema) exigem o Scheduler comercial | **Não adotado** |
| shadcn/ui | https://github.com/shadcn-ui/ui | 125.769 | referência de padrões | MIT | Padrões de componentes acessíveis | Componentes são copiados, não dependência; o Core já traz as primitivas necessárias | **Referência de UX** (nada copiado) |
| date-fns | https://github.com/date-fns/date-fns | 36.647 | 4.4.0 | MIT | Datas e fuso | Fuso exige pacote adicional; o necessário cabe em `Intl` | **Não adotado** |
| Cal.com | https://github.com/calcom/cal.com | — | — | AGPL-3.0 (com diretórios `ee/` comerciais) | Entender fluxo de reserva pública | Copyleft de rede: copiar obrigaria a abrir o sistema; `ee/` é proprietário | **Só referência conceitual**, nada lido em código |

## Decisão sobre a biblioteca de calendário
**Nenhuma biblioteca de calendário foi adicionada.** Razões: (1) o domínio exige uma visão **por profissional** e fuso fixo da empresa, que é exatamente o que as versões gratuitas não entregam bem; (2) a CSP estrita (`style-src` sem `unsafe-inline`) conflita com bibliotecas que posicionam eventos por estilo inline; (3) dia, semana e lista são grades simples que o sistema renderiza no servidor com classes estáticas, sem JavaScript de calendário no navegador, o que reduz peso e superfície; (4) as regras de disponibilidade vivem no banco, não na biblioteca. Custo aceito: sem arrastar-e-soltar (reagendar é por formulário, que também é mais acessível).

## Dependências adicionadas por este sistema
Nenhuma além do Core web (Next, React, Supabase, Zod, Tailwind, Vitest, Playwright). O pacote `recharts`, previsto no início, foi **removido** por não ser usado: os gráficos do painel são barras com o elemento nativo `<progress>` (acessível e compatível com a CSP).

## Pesquisa pendente
Nenhuma. Se uma consulta futura contradisser licença ou versão acima, atualizar esta tabela e `THIRD_PARTY_NOTICES.md` do Pack.
