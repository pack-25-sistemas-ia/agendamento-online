-- Agendamento Online — domínio no banco: perfis, cadastros, disponibilidade (semanal, exceção, bloqueio), horários livres com duração e intervalos,
-- reservas, conflitos, remarcação atômica, cancelamento, transições de status, snapshots e isolamento entre empresas.
-- Datas relativas a «hoje» da empresa (fuso America/Sao_Paulo): o teste não depende do dia em que roda.

\set as_oa 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a0","aal":"aal2","email":"oa@t.invalid"}'', true); set local role authenticated;'
\set as_ma 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a1","aal":"aal1","email":"ma@t.invalid"}'', true); set local role authenticated;'
\set as_pa 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a2","aal":"aal1","email":"pa@t.invalid"}'', true); set local role authenticated;'
\set as_pb 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a3","aal":"aal1","email":"pb@t.invalid"}'', true); set local role authenticated;'
\set as_va 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a4","aal":"aal1","email":"va@t.invalid"}'', true); set local role authenticated;'
\set as_xa 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a5","aal":"aal1","email":"xa@t.invalid"}'', true); set local role authenticated;'
\set as_ob 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000b0","aal":"aal2","email":"ob@t.invalid"}'', true); set local role authenticated;'

begin;

create function test.errmsg(q text) returns text language plpgsql as $$ begin execute q; return null; exception when others then return sqlerrm; end $$;
create function test.has(msg text, pat text, label text) returns void language plpgsql as $$ begin if msg is null or msg not like pat then raise exception 'FALHOU: % — esperado %, veio %', label, pat, coalesce(msg, '(sem erro)'); end if; end $$;
create function test.t(k text) returns uuid language sql as $$ select current_setting('t.' || k)::uuid $$;
create function test.sql(q text) returns void language plpgsql security definer set search_path = '' as $$ begin execute q; end $$;
create function test.cnt(q text) returns bigint language plpgsql security definer set search_path = '' as $$ declare n bigint; begin execute q into n; return n; end $$;
create function test.txt(q text) returns text language plpgsql security definer set search_path = '' as $$ declare s text; begin execute q into s; return s; end $$;
-- instante do horário LOCAL (America/Sao_Paulo) «HH:MM» na data d
create function test.at(d date, hhmm text) returns timestamptz language sql immutable as $$ select (d + hhmm::time) at time zone 'America/Sao_Paulo' $$;
create function test.day(n integer) returns date language sql stable as $$ select private.ag_today(test.t('org')) + n $$;
grant execute on all functions in schema test to anon, authenticated;

insert into auth.users (id, email) values
  ('ffffffff-0000-4000-8000-0000000000a0', 'oa@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a1', 'ma@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a2', 'pa@t.invalid'),
  ('ffffffff-0000-4000-8000-0000000000a3', 'pb@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a4', 'va@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a5', 'xa@t.invalid'),
  ('ffffffff-0000-4000-8000-0000000000b0', 'ob@t.invalid');

-- ===================================================================== (1) empresa, pessoas e perfis
:as_oa
do $$
declare org uuid;
begin
  org := public.create_organization('Studio Teste', 'studio-teste');
  perform set_config('t.org', org::text, true);
  insert into public.organization_members (organization_id, user_id, role) values
    (org, 'ffffffff-0000-4000-8000-0000000000a1', 'manager'), (org, 'ffffffff-0000-4000-8000-0000000000a2', 'member'),
    (org, 'ffffffff-0000-4000-8000-0000000000a3', 'member'), (org, 'ffffffff-0000-4000-8000-0000000000a4', 'viewer');
  assert (select count(*) from public.scheduling_settings where organization_id = org) = 1, 'configurações criadas junto com a empresa';
  assert private.ag_profile(org) = 'owner', 'dono é proprietário';
  -- profissionais e serviços
  perform set_config('t.profA', public.ag_save_professional(org, null, 'Ana Profissional', 'Especialista em cortes', '#2563eb', true, 'ffffffff-0000-4000-8000-0000000000a2')::text, true);
  perform set_config('t.profB', public.ag_save_professional(org, null, 'Beto Profissional', null, '#16a34a', true, 'ffffffff-0000-4000-8000-0000000000a3')::text, true);
  perform set_config('t.profC', public.ag_save_professional(org, null, 'Carla Sem Login', null, '#9333ea', true, null)::text, true);
  perform set_config('t.s1', public.ag_save_service(org, null, 'Corte completo', 'Corte com lavagem', 60, 10, 15, 8000, true, true)::text, true);
  perform set_config('t.s2', public.ag_save_service(org, null, 'Retoque rápido', null, 30, 0, 0, null, true, true)::text, true);
  perform set_config('t.s3', public.ag_save_service(org, null, 'Serviço só interno', null, 30, 0, 0, null, true, false)::text, true);
  perform public.ag_set_professional_services(org, test.t('profA'), array[test.t('s1'), test.t('s2'), test.t('s3')]);
  perform public.ag_set_professional_services(org, test.t('profB'), array[test.t('s2')]);
  perform public.ag_set_professional_services(org, test.t('profC'), array[test.t('s1')]);
  -- A: todos os dias 09–12 e 13–18; B: seg–sex 08–12; C: nenhum horário
  perform public.ag_save_weekly(org, test.t('profA'), (select jsonb_agg(x) from (
    select jsonb_build_object('weekday', d, 'start', '09:00', 'end', '12:00') x from generate_series(0, 6) d
    union all select jsonb_build_object('weekday', d, 'start', '13:00', 'end', '18:00') from generate_series(0, 6) d) q));
  perform public.ag_save_weekly(org, test.t('profB'), (select jsonb_agg(jsonb_build_object('weekday', d, 'start', '08:00', 'end', '12:00')) from generate_series(1, 5) d));
  raise notice 'PASS: empresa, profissionais, serviços e disponibilidade semanal (1)';
end $$;
reset role;

:as_ma
do $$
declare org uuid := test.t('org');
begin
  assert private.ag_profile(org) = 'manager', 'gestor/recepção';
  assert (select count(*) from public.professionals) = 3 and (select count(*) from public.services) = 3, 'gestor enxerga o cadastro inteiro';
  perform test.has(test.errmsg(format($q$select public.ag_save_settings(%L, '{"slot_step_minutes":15}')$q$, org)), '%sem permissão%', 'gestor não altera políticas');
  perform test.has(test.errmsg(format($q$select public.ag_save_professional(%L, %L, 'Ana Profissional', null, '#2563eb', true, null)$q$, org, test.t('profA'))), '%somente o proprietário vincula%', 'gestor não remove vínculo de usuário');
  perform test.has(test.errmsg(format($q$select public.ag_save_professional(%L, null, 'Dani Nova', null, '#2563eb', true, 'ffffffff-0000-4000-8000-0000000000a4')$q$, org)), '%somente o proprietário vincula%', 'gestor não vincula usuário');
  perform test.has(test.errmsg(format($q$select public.ag_anonymize_customer(%L, %L)$q$, org, gen_random_uuid())), '%sem permissão%', 'só o proprietário anonimiza');
  raise notice 'PASS: gestor gerencia o cadastro, mas não políticas nem vínculos de acesso (2)';
end $$;
reset role;

:as_va
do $$
begin
  assert (select count(*) from public.professionals) = 0 and (select count(*) from public.appointments) = 0, 'leitor não enxerga nada';
  perform test.has(test.errmsg(format($q$select public.ag_save_service(%L, null, 'Invasor', null, 30, 0, 0, null, true, true)$q$, test.t('org'))), '%sem permissão%', 'leitor não cadastra');
  raise notice 'PASS: leitor sem acesso (3)';
end $$;
reset role;

-- ===================================================================== (2) validações de cadastro e de disponibilidade
:as_ma
do $$
declare org uuid := test.t('org');
begin
  perform test.has(test.errmsg(format($q$select public.ag_save_service(%L, null, 'X', null, 30, 0, 0, null, true, true)$q$, org)), '%Nome deve ter%', 'nome curto');
  perform test.has(test.errmsg(format($q$select public.ag_save_service(%L, null, 'Duração ruim', null, 3, 0, 0, null, true, true)$q$, org)), '%duração deve ficar%', 'duração mínima');
  perform test.has(test.errmsg(format($q$select public.ag_save_service(%L, null, 'Intervalo ruim', null, 30, 300, 0, null, true, true)$q$, org)), '%intervalos devem ficar%', 'intervalo máximo');
  perform test.has(test.errmsg(format($q$select public.ag_save_weekly(%L, %L, '[{"weekday":1,"start":"09:00","end":"12:00"},{"weekday":1,"start":"11:00","end":"13:00"}]')$q$, org, test.t('profC'))), '%sobrepostos%', 'intervalos sobrepostos no mesmo dia');
  perform test.has(test.errmsg(format($q$select public.ag_save_weekly(%L, %L, '[{"weekday":1,"start":"12:00","end":"09:00"}]')$q$, org, test.t('profC'))), '%fim deve ser depois%', 'fim antes do início');
  perform test.has(test.errmsg(format($q$select public.ag_save_weekly(%L, %L, '[{"weekday":9,"start":"09:00","end":"12:00"}]')$q$, org, test.t('profC'))), '%dia da semana inválido%', 'dia inválido');
  perform test.has(test.errmsg(format($q$select public.ag_save_weekly(%L, %L, '[{"weekday":1,"start":"9h","end":"12:00"}]')$q$, org, test.t('profC'))), '%inválido%', 'horário mal formado');
  -- intervalos que se tocam (12:00 fim, 12:00 início) são permitidos
  perform public.ag_save_weekly(org, test.t('profC'), '[{"weekday":1,"start":"09:00","end":"12:00"},{"weekday":1,"start":"12:00","end":"13:00"}]');
  assert (select count(*) from public.availability_rules where professional_id = test.t('profC')) = 2, 'intervalos adjacentes aceitos';
  perform public.ag_save_weekly(org, test.t('profC'), '[]');
  assert (select count(*) from public.availability_rules where professional_id = test.t('profC')) = 0, 'salvar vazio limpa a semana';
  -- serviço de outra empresa não se associa
  perform test.has(test.errmsg(format($q$select public.ag_set_professional_services(%L, %L, array[gen_random_uuid()])$q$, org, test.t('profA'))), '%serviço não encontrado%', 'serviço inexistente');
  raise notice 'PASS: validações de cadastro e de intervalos (4)';
end $$;
reset role;

-- ===================================================================== (3) horários livres: duração, intervalos (buffers), passo e grade
:as_ma
do $$
declare org uuid := test.t('org'); d date := test.day(3); r jsonb; got text[];
begin
  -- Corte completo (60 + 10 antes + 15 depois), janelas 09–12 e 13–18, passo 30:
  -- manhã 09:30, 10:00, 10:30 · tarde 13:30 … 16:30 (a ocupação inteira precisa caber na janela)
  r := public.ag_slots(org, test.t('profA'), test.t('s1'), d, d);
  select array_agg(to_char(((x ->> 'at')::timestamptz at time zone 'America/Sao_Paulo'), 'HH24:MI') order by (x ->> 'at')::timestamptz) into got from jsonb_array_elements(r) x;
  assert got = array['09:30', '10:00', '10:30', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30'], 'horários do corte completo: ' || array_to_string(got, ',');
  -- Retoque (30 min, sem intervalos): 09:00 … 11:30 e 13:00 … 17:30
  r := public.ag_slots(org, test.t('profA'), test.t('s2'), d, d);
  assert jsonb_array_length(r) = 6 + 10, 'retoque: 6 + 10 horários';
  -- profissional que não faz o serviço, serviço inexistente e profissional sem horários: lista vazia
  assert jsonb_array_length(public.ag_slots(org, test.t('profB'), test.t('s1'), d, d)) = 0, 'sem vínculo → vazio';
  assert jsonb_array_length(public.ag_slots(org, test.t('profC'), test.t('s1'), d, d)) = 0, 'sem horários → vazio';
  raise notice 'PASS: horários livres respeitam duração, intervalos e janelas (5)';
end $$;
reset role;

-- ===================================================================== (4) reserva administrativa, ocupação com intervalos e reservas adjacentes
:as_ma
do $$
declare org uuid := test.t('org'); d date := test.day(3); a1 uuid; a2 uuid; e record; c uuid;
begin
  a1 := public.ag_create_appointment(org, test.t('profA'), test.t('s1'), null, '{"name":"Cliente Um","phone":"(11) 91234-5678"}', test.at(d, '10:00'), 'cliente prefere água sem gás');
  perform set_config('t.a1', a1::text, true);
  select * into e from public.schedule_entries where id = (select schedule_entry_id from public.appointments where id = a1);
  assert e.kind = 'appointment' and e.active, 'ocupação ativa na agenda';
  assert e.occupied_start_at = test.at(d, '09:50') and e.occupied_end_at = test.at(d, '11:15'), 'ocupação = 09:50–11:15 (buffers somados ao atendimento 10:00–11:00)';
  assert (select starts_at from public.appointments where id = a1) = test.at(d, '10:00') and (select ends_at from public.appointments where id = a1) = test.at(d, '11:00'), 'atendimento 10:00–11:00';
  assert (select status from public.appointments where id = a1) = 'scheduled' and (select source from public.appointments where id = a1) = 'admin', 'nasce agendado, origem administrativa';
  assert (select count(*) from public.appointment_events where appointment_id = a1 and event_type = 'created') = 1, 'evento de criação';
  -- o horário ocupado some da lista; os adjacentes continuam livres
  assert not exists (select 1 from jsonb_array_elements(public.ag_slots(org, test.t('profA'), test.t('s1'), d, d)) x where (x ->> 'at')::timestamptz = test.at(d, '10:00')), 'horário reservado não é oferecido';
  -- conflito: início dentro da ocupação (10:30) ou antes do fim do intervalo (11:14) é recusado
  perform test.has(test.errmsg(format($q$select public.ag_create_appointment(%L, %L, %L, null, '{"name":"Cliente Dois"}', %L, null)$q$, org, test.t('profA'), test.t('s2'), test.at(d, '10:30'))), '%acabou de ser reservado%', 'sobreposição recusada');
  perform test.has(test.errmsg(format($q$select public.ag_create_appointment(%L, %L, %L, null, '{"name":"Cliente Dois"}', %L, null)$q$, org, test.t('profA'), test.t('s2'), test.at(d, '11:14'))), '%acabou de ser reservado%', 'um minuto antes do fim da ocupação');
  -- reserva adjacente: começa exatamente quando a ocupação termina (11:15) → permitida
  a2 := public.ag_create_appointment(org, test.t('profA'), test.t('s2'), null, '{"name":"Cliente Dois","email":"Dois@Exemplo.com"}', test.at(d, '11:15'), null);
  perform set_config('t.a2', a2::text, true);
  assert (select email from public.customers where id = (select customer_id from public.appointments where id = a2)) = 'dois@exemplo.com', 'e-mail normalizado';
  -- fora da janela de atendimento (08:00 e 12:30 e domingo-sem-regra de C)
  perform test.has(test.errmsg(format($q$select public.ag_create_appointment(%L, %L, %L, null, '{"name":"Cliente Três"}', %L, null)$q$, org, test.t('profA'), test.t('s2'), test.at(d, '08:00'))), '%não está disponível%', 'antes da janela');
  perform test.has(test.errmsg(format($q$select public.ag_create_appointment(%L, %L, %L, null, '{"name":"Cliente Três"}', %L, null)$q$, org, test.t('profA'), test.t('s1'), test.at(d, '11:30'))), '%não está disponível%', 'ocupação ultrapassa o fim da janela');
  perform test.has(test.errmsg(format($q$select public.ag_create_appointment(%L, %L, %L, null, '{"name":"Cliente Três"}', %L, null)$q$, org, test.t('profA'), test.t('s2'), test.at(d, '12:30'))), '%não está disponível%', 'intervalo de almoço');
  -- passado, serviço desativado, profissional sem o serviço
  perform test.has(test.errmsg(format($q$select public.ag_create_appointment(%L, %L, %L, null, '{"name":"Cliente Três"}', now() - interval '1 hour', null)$q$, org, test.t('profA'), test.t('s2'))), '%já passou%', 'horário no passado');
  perform test.has(test.errmsg(format($q$select public.ag_create_appointment(%L, %L, %L, null, '{"name":"Cliente Três"}', %L, null)$q$, org, test.t('profB'), test.t('s1'), test.at(d, '09:00'))), '%não realiza o serviço%', 'profissional sem o serviço');
  -- cliente existente é reaproveitado por escolha da equipe, nunca por semelhança
  c := (select customer_id from public.appointments where id = a1);
  perform public.ag_create_appointment(org, test.t('profB'), test.t('s2'), c, null, test.at(d, '08:00'), null);
  assert (select count(*) from public.customers where name = 'Cliente Um') = 1, 'mesmo cliente selecionado';
  perform public.ag_save_customer(org, null, 'Cliente Um', null, '(11) 91234-5678');
  assert (select count(*) from public.customers where name = 'Cliente Um') = 2, 'mesmo nome e telefone NÃO são mesclados automaticamente';
  raise notice 'PASS: reserva administrativa, ocupação com intervalos, adjacência e recusas (6)';
end $$;
reset role;

-- ===================================================================== (5) a proteção está NO BANCO: sem passar pela função, a exclusão ainda vale
do $$
declare d date := test.day(3);
begin
  perform test.has(test.errmsg(format($q$select test.sql(%L)$q$, format('insert into public.schedule_entries (organization_id, professional_id, kind, occupied_start_at, occupied_end_at) values (%L, %L, ''block'', %L, %L)',
    test.t('org'), test.t('profA'), test.at(d, '10:30'), test.at(d, '10:45')))), '%schedule_entries_no_overlap%', 'exclusão no banco recusa sobreposição direta');
  -- adjacente passa; inativa não conflita
  perform test.sql(format('insert into public.schedule_entries (organization_id, professional_id, kind, occupied_start_at, occupied_end_at, block_reason) values (%L, %L, ''block'', %L, %L, ''x'')',
    test.t('org'), test.t('profA'), test.at(d, '17:00'), test.at(d, '17:30')));
  perform test.sql(format('insert into public.schedule_entries (organization_id, professional_id, kind, occupied_start_at, occupied_end_at, block_reason, active) values (%L, %L, ''block'', %L, %L, ''y'', false)',
    test.t('org'), test.t('profA'), test.at(d, '17:10'), test.at(d, '17:20')));
  raise notice 'PASS: exclusion constraint impede conflito mesmo sem a função (7)';
end $$;

-- ===================================================================== (6) remarcação atômica, conflito preserva o original, troca de profissional
:as_ma
do $$
declare org uuid := test.t('org'); d date := test.day(3); a1 uuid := test.t('a1'); before_e timestamptz; ent uuid;
begin
  select schedule_entry_id into ent from public.appointments where id = a1;
  -- conflito: tentar mover o corte (10:00) para cima do retoque das 11:15 → original intacto
  perform test.has(test.errmsg(format($q$select public.ag_reschedule_appointment(%L, %L, %L, null)$q$, org, a1, test.at(d, '10:45'))), '%acabou de ser reservado%', 'remarcação conflitante recusada');
  assert (select starts_at from public.appointments where id = a1) = test.at(d, '10:00'), 'compromisso original preservado';
  assert (select occupied_start_at from public.schedule_entries where id = ent) = test.at(d, '09:50') and (select active from public.schedule_entries where id = ent), 'ocupação original preservada';
  -- remarcação válida: para a tarde (14:00); a manhã é liberada na MESMA transação
  perform public.ag_reschedule_appointment(org, a1, test.at(d, '14:00'), null);
  assert (select starts_at from public.appointments where id = a1) = test.at(d, '14:00') and (select ends_at from public.appointments where id = a1) = test.at(d, '15:00'), 'novo horário';
  assert (select occupied_start_at from public.schedule_entries where id = ent) = test.at(d, '13:50') and (select occupied_end_at from public.schedule_entries where id = ent) = test.at(d, '15:15'), 'ocupação acompanha (buffers do momento da reserva)';
  assert exists (select 1 from jsonb_array_elements(public.ag_slots(org, test.t('profA'), test.t('s1'), d, d)) x where (x ->> 'at')::timestamptz = test.at(d, '10:00')), 'manhã liberada';
  assert (select safe_metadata ->> 'professional_changed' from public.appointment_events where appointment_id = a1 and event_type = 'rescheduled') = 'false', 'evento registra a remarcação';
  -- horários para remarcar: usam a duração do momento da reserva e liberam o próprio horário atual
  assert exists (select 1 from jsonb_array_elements(public.ag_reschedule_slots(org, a1, null, d, d)) x where (x ->> 'at')::timestamptz = test.at(d, '14:00')), 'o horário atual do próprio compromisso aparece como livre para ele';
  assert not exists (select 1 from jsonb_array_elements(public.ag_reschedule_slots(org, a1, null, d, d)) x where (x ->> 'at')::timestamptz = test.at(d, '17:30')), 'ocupação de 85 min não cabe às 17:30 (janela até 18:00)';
  assert jsonb_array_length(public.ag_reschedule_slots(org, test.t('a2'), null, d, d)) >= 0, 'lista de remarcação responde';
  -- fora do horário de atendimento e mesmo horário de outro compromisso
  perform test.has(test.errmsg(format($q$select public.ag_reschedule_appointment(%L, %L, %L, null)$q$, org, a1, test.at(d, '20:00'))), '%não está disponível%', 'remarcar para fora da janela');
  -- troca de profissional: o retoque (a2, 11:15 com Ana) vai para o Beto às 09:00 (B trabalha 08–12 em dias úteis)
  perform public.ag_save_override_day(org, test.t('profB'), d, false, '[{"start":"09:00","end":"12:00"}]');
  perform public.ag_reschedule_appointment(org, test.t('a2'), test.at(d, '09:00'), test.t('profB'));
  assert (select professional_id from public.appointments where id = test.t('a2')) = test.t('profB'), 'compromisso passou para o outro profissional';
  assert (select professional_id from public.schedule_entries where id = (select schedule_entry_id from public.appointments where id = test.t('a2'))) = test.t('profB'), 'ocupação também';
  assert (select safe_metadata ->> 'professional_changed' from public.appointment_events where appointment_id = test.t('a2') and event_type = 'rescheduled') = 'true', 'evento registra a troca';
  raise notice 'PASS: remarcação atômica preserva o original em conflito e libera o horário antigo (8)';
end $$;
reset role;

-- ===================================================================== (7) exceção por data, dia fechado e bloqueios
:as_ma
do $$
declare org uuid := test.t('org'); d4 date := test.day(4); d5 date := test.day(5); r jsonb; blk uuid;
begin
  -- exceção SUBSTITUI o dia: Ana só atende 15:00–17:00 em d4
  perform public.ag_save_override_day(org, test.t('profA'), d4, false, '[{"start":"15:00","end":"17:00"}]');
  r := public.ag_slots(org, test.t('profA'), test.t('s2'), d4, d4);
  assert jsonb_array_length(r) = 4 and not exists (select 1 from jsonb_array_elements(r) x where (x ->> 'at')::timestamptz < test.at(d4, '15:00')), 'a exceção substitui a regra semanal do dia';
  -- vários intervalos na exceção, sobrepostos são recusados
  perform test.has(test.errmsg(format($q$select public.ag_save_override_day(%L, %L, %L, false, '[{"start":"09:00","end":"12:00"},{"start":"11:00","end":"13:00"}]')$q$, org, test.t('profA'), d4)), '%sobrepostos%', 'exceção com intervalos sobrepostos');
  -- dia fechado
  perform public.ag_save_override_day(org, test.t('profA'), d5, true, null);
  assert jsonb_array_length(public.ag_slots(org, test.t('profA'), test.t('s2'), d5, d5)) = 0, 'dia fechado não tem horários';
  perform test.has(test.errmsg(format($q$select public.ag_create_appointment(%L, %L, %L, null, '{"name":"Cliente Fechado"}', %L, null)$q$, org, test.t('profA'), test.t('s2'), test.at(d5, '10:00'))), '%não está disponível%', 'reserva em dia fechado');
  perform public.ag_delete_override_day(org, test.t('profA'), d5);
  assert jsonb_array_length(public.ag_slots(org, test.t('profA'), test.t('s2'), d5, d5)) = 16, 'remover a exceção devolve a regra semanal';
  -- bloqueio: subtrai da disponibilidade e disputa o mesmo espaço
  blk := public.ag_create_block(org, test.t('profA'), test.at(d5, '09:00'), test.at(d5, '12:00'), 'Consulta médica');
  assert jsonb_array_length(public.ag_slots(org, test.t('profA'), test.t('s2'), d5, d5)) = 10, 'bloqueio da manhã remove 6 horários';
  perform test.has(test.errmsg(format($q$select public.ag_create_block(%L, %L, %L, %L, null)$q$, org, test.t('profA'), test.at(d5, '11:00'), test.at(d5, '13:30'))), '%já existe um atendimento ou bloqueio%', 'bloqueio sobre bloqueio');
  perform test.has(test.errmsg(format($q$select public.ag_create_appointment(%L, %L, %L, null, '{"name":"Cliente Bloqueado"}', %L, null)$q$, org, test.t('profA'), test.t('s2'), test.at(d5, '10:00'))), '%acabou de ser reservado%', 'reserva sobre bloqueio');
  -- bloqueio sobre atendimento existente (a1 das 14:00 em d3)
  perform test.has(test.errmsg(format($q$select public.ag_create_block(%L, %L, %L, %L, null)$q$, org, test.t('profA'), test.at(test.day(3), '14:00'), test.at(test.day(3), '14:30'))), '%já existe um atendimento ou bloqueio%', 'bloqueio sobre atendimento');
  perform public.ag_cancel_block(org, blk);
  assert jsonb_array_length(public.ag_slots(org, test.t('profA'), test.t('s2'), d5, d5)) = 16, 'cancelar o bloqueio devolve os horários';
  assert (select count(*) from public.schedule_entries where id = blk) = 1 and not (select active from public.schedule_entries where id = blk), 'bloqueio cancelado é preservado, inativo';
  perform test.has(test.errmsg(format($q$select test.sql('delete from public.schedule_entries where id = ''%s''')$q$, blk)), '%não pode ser apagado%', 'agenda nunca é apagada');
  raise notice 'PASS: exceção por data, dia fechado e bloqueios (9)';
end $$;
reset role;

-- ===================================================================== (8) estados: confirmar, cancelar libera o horário, concluir/não compareceu só depois do horário
:as_ma
do $$
declare org uuid := test.t('org'); d date := test.day(3); a1 uuid := test.t('a1'); n integer;
begin
  perform public.ag_set_status(org, a1, 'confirm', null);
  assert (select status from public.appointments where id = a1) = 'confirmed', 'confirmado';
  perform test.has(test.errmsg(format($q$select public.ag_set_status(%L, %L, 'confirm', null)$q$, org, a1)), '%já está neste estado%', 'confirmar duas vezes');
  perform test.has(test.errmsg(format($q$select public.ag_set_status(%L, %L, 'complete', null)$q$, org, a1)), '%só é possível registrar depois do horário%', 'concluir antes do horário');
  perform test.has(test.errmsg(format($q$select public.ag_set_status(%L, %L, 'no_show', null)$q$, org, a1)), '%só é possível registrar depois do horário%', 'não compareceu antes do horário');
  -- cancelar libera o horário (a mesma hora pode ser reservada de novo) e preserva o registro
  perform public.ag_set_status(org, a1, 'cancel', 'Cliente avisou que não poderá vir');
  assert (select status from public.appointments where id = a1) = 'cancelled' and (select cancellation_reason from public.appointments where id = a1) like 'Cliente avisou%', 'cancelado com motivo';
  assert not (select active from public.schedule_entries where id = (select schedule_entry_id from public.appointments where id = a1)), 'ocupação liberada';
  perform public.ag_create_appointment(org, test.t('profA'), test.t('s1'), null, '{"name":"Cliente Novo"}', test.at(d, '14:00'), null);
  assert (select count(*) from public.appointments where id = a1) = 1, 'o cancelado continua existindo';
  perform test.has(test.errmsg(format($q$select public.ag_set_status(%L, %L, 'confirm', null)$q$, org, a1)), '%cancelado%', 'cancelado não volta');
  perform test.has(test.errmsg(format($q$select public.ag_reschedule_appointment(%L, %L, %L, null)$q$, org, a1, test.at(d, '16:00'))), '%só atendimentos pendentes ou confirmados%', 'cancelado não é remarcado');
  perform test.has(test.errmsg(format($q$select test.sql('delete from public.appointments where id = ''%s''')$q$, a1)), '%não pode ser apagado%', 'compromisso nunca é apagado');
  perform test.has(test.errmsg(format($q$select test.sql('update public.appointment_events set event_type = ''created'' where appointment_id = ''%s''')$q$, a1)), '%imutável%', 'histórico é imutável');
  -- compromisso no passado (inserido direto, como dado histórico): concluir e não comparecimento respeitam o horário
  execute 'set constraints all immediate'; execute 'set constraints all deferred'; -- travas do COMMIT conferidas como o papel do gestor
  raise notice 'PASS: confirmação, cancelamento que libera o horário e regras de conclusão (10)';
end $$;
reset role;

do $$
declare org uuid := test.t('org'); ent uuid; ent2 uuid; c uuid; p1 uuid; p2 uuid;
begin
  c := (select id from public.customers where organization_id = org limit 1);
  insert into public.schedule_entries (organization_id, professional_id, kind, occupied_start_at, occupied_end_at) values (org, test.t('profA'), 'appointment', now() - interval '3 hours', now() - interval '2 hours') returning id into ent;
  insert into public.appointments (organization_id, schedule_entry_id, professional_id, customer_id, service_id, starts_at, ends_at, source, service_name_snapshot, duration_minutes_snapshot, buffer_before_minutes_snapshot, buffer_after_minutes_snapshot)
  values (org, ent, test.t('profA'), c, test.t('s2'), now() - interval '3 hours', now() - interval '2 hours' , 'admin', 'Retoque rápido', 60, 0, 0) returning id into p1;
  insert into public.schedule_entries (organization_id, professional_id, kind, occupied_start_at, occupied_end_at) values (org, test.t('profA'), 'appointment', now() - interval '5 hours', now() - interval '4 hours') returning id into ent2;
  insert into public.appointments (organization_id, schedule_entry_id, professional_id, customer_id, service_id, starts_at, ends_at, source, service_name_snapshot, duration_minutes_snapshot, buffer_before_minutes_snapshot, buffer_after_minutes_snapshot)
  values (org, ent2, test.t('profA'), c, test.t('s2'), now() - interval '5 hours', now() - interval '4 hours', 'admin', 'Retoque rápido', 60, 0, 0) returning id into p2;
  perform set_config('t.past1', p1::text, true); perform set_config('t.past2', p2::text, true);
end $$;

:as_pa
do $$
declare org uuid := test.t('org');
begin
  assert private.ag_profile(org) = 'professional', 'profissional vinculado';
  -- Ana só vê a própria agenda e os clientes dos próprios atendimentos
  assert (select count(*) from public.professionals) = 1, 'vê só o próprio registro';
  assert (select count(*) from public.appointments where professional_id <> test.t('profA')) = 0, 'não vê agenda de outros';
  assert (select count(*) from public.customers) = (select count(distinct customer_id) from public.appointments), 'só clientes dos próprios atendimentos';
  -- conclui o atendimento passado dela
  perform public.ag_set_status(org, test.t('past1'), 'complete', null);
  execute 'set constraints all immediate'; execute 'set constraints all deferred'; -- travas do COMMIT conferidas como o papel do profissional
  assert (select status from public.appointments where id = test.t('past1')) = 'completed', 'concluído pela profissional';
  perform public.ag_set_status(org, test.t('past2'), 'no_show', null);
  assert (select status from public.appointments where id = test.t('past2')) = 'no_show', 'não compareceu registrado';
  perform test.has(test.errmsg(format($q$select public.ag_set_status(%L, %L, 'cancel', 'x')$q$, org, test.t('past1'))), '%sem permissão%', 'profissional não cancela');
  perform test.has(test.errmsg(format($q$select public.ag_reschedule_appointment(%L, %L, now() + interval '3 days', null)$q$, org, test.t('past1'))), '%sem permissão%', 'profissional não remarca');
  perform test.has(test.errmsg(format($q$select public.ag_create_appointment(%L, %L, %L, null, '{"name":"Intruso"}', now() + interval '5 days', null)$q$, org, test.t('profA'), test.t('s2'))), '%sem permissão%', 'profissional não cria');
  perform test.has(test.errmsg(format($q$select public.ag_save_weekly(%L, %L, '[]')$q$, org, test.t('profA'))), '%sem permissão%', 'profissional não altera disponibilidade');
  perform test.has(test.errmsg(format($q$select public.ag_create_block(%L, %L, now() + interval '5 days', now() + interval '6 days', null)$q$, org, test.t('profA'))), '%sem permissão%', 'profissional não bloqueia');
  perform test.has(test.errmsg(format($q$select public.ag_set_status(%L, %L, 'complete', null)$q$, org, test.t('a2'))), '%não encontrado%', 'atendimento de outro profissional não existe para ela');
  perform test.has(test.errmsg(format($q$select public.ag_save_settings(%L, '{"slot_step_minutes":15}')$q$, org)), '%sem permissão%', 'profissional não altera políticas');
  -- transição inválida em estado final
  perform test.has(test.errmsg(format($q$select public.ag_set_status(%L, %L, 'no_show', null)$q$, org, test.t('past1'))), '%concluído%', 'concluído não vira não comparecimento');
  raise notice 'PASS: profissional vê e conclui só o que é dele (11)';
end $$;
reset role;

:as_pb
do $$
begin
  assert (select count(*) from public.appointments where id in (test.t('past1'), test.t('past2'))) = 0, 'outro profissional não vê os atendimentos da Ana';
  assert (select count(*) from public.customers where id in (select customer_id from public.appointments where professional_id = test.t('profA'))) <= (select count(distinct customer_id) from public.appointments),
    'cliente só aparece se houver atendimento com ele';
  perform test.has(test.errmsg(format($q$select public.ag_update_notes(%L, %L, 'bisbilhotando')$q$, test.t('org'), test.t('past1'))), '%não encontrado%', 'não edita notas de outro profissional');
  raise notice 'PASS: isolamento entre profissionais (12)';
end $$;
reset role;

-- ===================================================================== (9) snapshots e imutabilidade
:as_ma
do $$
declare org uuid := test.t('org'); a uuid;
begin
  a := (select id from public.appointments where service_id = test.t('s1') and status = 'scheduled' limit 1);
  -- alterar o serviço NÃO altera retroativamente duração, intervalos nem preço das reservas existentes
  perform public.ag_save_service(org, test.t('s1'), 'Corte completo premium', 'Novo', 90, 20, 30, 15000, true, true);
  assert (select service_name_snapshot from public.appointments where id = a) = 'Corte completo' and (select duration_minutes_snapshot from public.appointments where id = a) = 60
    and (select buffer_before_minutes_snapshot from public.appointments where id = a) = 10 and (select reference_price_cents_snapshot from public.appointments where id = a) = 8000, 'snapshot preservado';
  assert (select ends_at - starts_at from public.appointments where id = a) = interval '60 minutes', 'duração da reserva existente intacta';
  -- remarcar mantém a duração do momento da reserva (60 min), não a nova (90)
  perform public.ag_reschedule_appointment(org, a, (select starts_at + interval '30 minutes' from public.appointments where id = a), null);
  assert (select ends_at - starts_at from public.appointments where id = a) = interval '60 minutes', 'remarcação mantém a duração original';
  perform public.ag_save_service(org, test.t('s1'), 'Corte completo', 'Corte com lavagem', 60, 10, 15, 8000, true, true);
  -- campos do compromisso são imutáveis, até para quem tem acesso direto
  perform test.has(test.errmsg(format($q$select test.sql('update public.appointments set duration_minutes_snapshot = 5 where id = ''%s''')$q$, a)), '%imutáveis%', 'snapshot imutável');
  perform test.has(test.errmsg(format($q$select test.sql('update public.appointments set customer_id = (select id from public.customers where id <> customer_id limit 1) where id = ''%s''')$q$, a)), '%imutáveis%', 'cliente imutável');
  perform test.has(test.errmsg(format($q$select test.sql('update public.appointments set status = ''completed'' where id = ''%s''')$q$, test.t('past2'))), '%transição de status inválida%', 'estado final é final');
  -- ocupação divergente do compromisso é barrada no commit
  perform test.has(test.errmsg(format($q$select test.sql('set constraints all immediate; update public.schedule_entries set occupied_end_at = occupied_end_at + interval ''5 minutes'' where id = (select schedule_entry_id from public.appointments where id = ''%s'')')$q$, a)), '%ocupação da agenda diverge%', 'ocupação sempre consistente com o compromisso');
  -- desativar serviço impede NOVAS reservas, mas não apaga nem invalida as existentes
  perform public.ag_save_service(org, test.t('s3'), 'Serviço só interno', null, 30, 0, 0, null, false, false);
  perform test.has(test.errmsg(format($q$select public.ag_create_appointment(%L, %L, %L, null, '{"name":"X Y"}', %L, null)$q$, org, test.t('profA'), test.t('s3'), test.at(test.day(6), '10:00'))), '%serviço não está disponível%', 'serviço desativado');
  raise notice 'PASS: snapshots e imutabilidade (13)';
end $$;
reset role;

-- ===================================================================== (10) isolamento entre empresas
:as_ob
do $$
declare org2 uuid; org uuid := test.t('org'); sv2 uuid; pr2 uuid;
begin
  org2 := public.create_organization('Outra Empresa', 'outra-empresa');
  perform set_config('t.org2', org2::text, true);
  sv2 := public.ag_save_service(org2, null, 'Serviço B', null, 30, 0, 0, null, true, true);
  pr2 := public.ag_save_professional(org2, null, 'Profissional B', null, '#000000', true, null);
  assert (select count(*) from public.appointments) = 0 and (select count(*) from public.customers) = 0 and (select count(*) from public.services) = 1, 'a outra empresa não enxerga nada daqui';
  perform test.has(test.errmsg(format($q$select public.ag_create_appointment(%L, %L, %L, null, '{"name":"Invasor"}', now() + interval '3 days', null)$q$, org, test.t('profA'), test.t('s2'))), '%sem permissão%', 'não escreve na empresa alheia');
  perform test.has(test.errmsg(format($q$select public.ag_set_professional_services(%L, %L, array[%L]::uuid[])$q$, org2, pr2, test.t('s2'))), '%serviço não encontrado%', 'serviço de outra empresa não se associa');
  perform test.has(test.errmsg(format($q$select public.ag_slots(%L, %L, %L, current_date, current_date)$q$, org, test.t('profA'), test.t('s2'))), '%sem permissão%', 'não lê horários da empresa alheia');
  -- no banco: associação e compromisso cruzando empresas são barrados pelas chaves compostas
  perform test.has(test.errmsg(format($q$select test.sql('insert into public.professional_services (organization_id, professional_id, service_id) values (''%s'', ''%s'', ''%s'')')$q$, org2, pr2, test.t('s2'))), '%violates foreign key%', 'FK composta: serviço de outra empresa');
  perform test.has(test.errmsg(format($q$select test.sql('insert into public.availability_rules (organization_id, professional_id, weekday, local_start_time, local_end_time) values (''%s'', ''%s'', 6, ''09:00'', ''10:00'')')$q$, org2, test.t('profB'))), '%violates foreign key%', 'FK composta: disponibilidade de profissional alheio');
  raise notice 'PASS: isolamento entre empresas, inclusive por chave composta (14)';
end $$;
reset role;

rollback;
