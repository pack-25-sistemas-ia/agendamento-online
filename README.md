# Agendamento Online

> Agenda com **disponibilidade real**: o cliente reserva sozinho numa página pública, o banco impede dois atendimentos no mesmo horário, e cliente e equipe remarcam ou cancelam sem planilha nem troca de mensagens.

**Público:** clínicas, salões e prestadores com agenda · **Problema:** agenda no papel ou no chat gera conflito e falta · **Proposta:** reserva pública + agenda administrativa + impedimento de conflito no próprio banco.

## O que faz
- **Profissionais, serviços e disponibilidade**: cada profissional faz só os serviços vinculados a ele; janelas semanais, **exceções por data** (substituem o dia) e **bloqueios** (férias, almoço, manutenção). Serviço com duração e **intervalos antes/depois**.
- **Página pública de reservas** (`/agendar/<slug>`): o cliente escolhe serviço, profissional, data e horário e informa nome e contato, com consentimento. Sem conta. Marca da empresa (nome, cor, logotipo, textos e política).
- **Link seguro de gerenciamento** (`/reserva/<token>`): o cliente vê, **reagenda** ou **cancela** dentro dos prazos que você define. O token tem 256 bits e o banco guarda só o hash.
- **Agenda administrativa** (dia, semana e lista), reserva manual, reagendamento por formulário, confirmação, conclusão, não comparecimento, notas internas e histórico de cada atendimento.
- **Anti-conflito no banco**: restrição de exclusão por profissional + trava por profissional; reservas simultâneas, reserva × bloqueio e remarcações concorrentes são decididas pelo PostgreSQL, não pela tela.
- **Painel** com dados reais (atendimentos de hoje, pendentes, concluídos, cancelados, taxa de não comparecimento, serviços mais agendados, volume por profissional), **exportação CSV** segura e **LGPD** (anonimizar cliente, auditoria de exportação).
- **Multiempresa com RLS**; perfis: proprietário, gestor/recepção e profissional (vê e conclui só os próprios atendimentos).

## Limites do MVP (fora do escopo)
Pagamento/gateway, videochamada, envio automático de e-mail/WhatsApp/SMS de lembrete (o cliente recebe o link na tela e a equipe pode reemitir), sincronização com Google/Outlook, lista de espera, pacotes e recorrência.

## Começar em 1 minuto (com Claude Code ou Codex)

1. Abra o **Claude Code** (ou o Codex) numa pasta vazia do seu computador.
2. Copie o link deste repositório e cole no chat com o pedido abaixo:

```text
Instale o Agendamento Online: https://github.com/pack-25-sistemas-ia/agendamento-online
Clone numa pasta nova e siga o guia .claude/commands/instalar.md. Explique cada passo e me pergunte quando precisar de algo meu.
```

3. Pronto: o agente clona, instala, sobe o banco local, carrega os dados de demonstração e abre o sistema. Depois da primeira vez, dentro da pasta, basta digitar `/instalar` no Claude Code para refazer ou consertar a instalação.

Prefere fazer à mão? Os passos manuais estão logo abaixo.


## Pré-requisitos
Node 22+, pnpm 12, Docker (Supabase local e `pnpm test:db`), conta Supabase **na região de São Paulo** para produção, hospedagem Node (ex.: Vercel).

## Instalação isolada
```bash
pnpm install --frozen-lockfile
cp .env.example .env.local        # preencha com `supabase status` e gere BOOKING_TOKEN_SECRET (instruções no arquivo)
supabase start && supabase db reset
node scripts/seed-demo.mjs        # opcional: empresa fictícia «Estúdio Aurora (demonstração)»
pnpm dev                          # http://localhost:3000
```
O `supabase db reset` aplica só as **migrações** (sem usuário nem dado). `scripts/seed-demo.mjs` cria usuários `@demo.exemplo` com **senha aleatória**, gravada em `node_modules/.cache/ag-demo-credentials.json` (não há senha fixa no código).

## Primeiro administrador e configuração
1. Em `/signup` crie a conta e a empresa (o primeiro usuário vira proprietário) e ative o **2º fator (TOTP)**: as operações de escrita o exigem.
2. **Profissionais** → cadastre e vincule os serviços; **Serviços** → duração e intervalos; **Disponibilidade** → janelas semanais, exceções e bloqueios.
3. **Configurações** → fuso, passo dos horários, antecedência mínima, horizonte e prazos de cancelamento/reagendamento.
4. **Página de reservas** → marque «Página ativa», defina nome, cor, logotipo e política e **copie o link** (`/agendar/<slug>`) para Instagram, WhatsApp e Google. O endereço não dá acesso ao painel.
5. **Alterar a marca**: nome exibido, cor principal (paleta), logotipo (PNG/JPG/WebP até 512 KB) e textos, em *Página de reservas*.

## Qualidade
`pnpm lint` · `pnpm typecheck` · `pnpm test` (motor de horários, estados, token, CSV) · `pnpm test:db` (SQL: RLS, domínio, fuso/DST, público, segurança) · `pnpm test:concurrency` (sessões simultâneas reais) · `pnpm test:mutation` (quebra regras de propósito e exige que algum teste falhe) · `pnpm test:e2e` (Playwright). Resultados reais em `MEMORY.md`.

## Deploy, custos e backup
Veja `docs/DEPLOYMENT.md`: variáveis, migrações em produção (sem seed), SMTP, MFA, hospedagem, **custos externos** (Supabase, hospedagem, SMTP, domínio) e **backup/restauração**.

## Documentação
`docs/ARCHITECTURE.md` · `DATA_MODEL.md` · `DECISIONS.md` · `REFERENCES.md` · `FEATURES.md` · `DEPLOYMENT.md` · `SECURITY.md`.

## Privacidade (LGPD)
Dados pessoais tratados: **nome, telefone, e-mail e horários de atendimento** (risco médio). Coleta mínima, consentimento no formulário público, sem PII em logs, anonimização de cliente e trilha de auditoria. Quem implanta é o controlador dos dados; este software não substitui assessoria jurídica.

> Valor de implantação ilustrativo e sem promessa de resultado: veja `catalogo/sistemas.json` no repositório do Pack.
