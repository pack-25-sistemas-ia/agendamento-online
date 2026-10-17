-- Agendamento Online — regras finas do motor e das portas públicas, chamadas DIRETAMENTE (sem depender das proteções em camadas):
-- profissional inativo, conflito/adjacência/remarcação (ag_check_slot e ag_list_slots), teto de 62 dias, passado, regra desativada,
-- telefone, limite de abuso por empresa, reserva encerrada sem horários e perfis sem vínculo.
-- Cada bloco existe porque uma mutação (scripts/mutation-check.mjs) sobreviveu sem ele.

\set as_od 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000d0","aal":"aal2","email":"od@t.invalid"}'', true); set local role authenticated;'
\set as_md 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000d1","aal":"aal1","email":"md@t.invalid"}'', true); set local role authenticated;'
\set as_vd 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000d2","aal":"aal1","email":"vd@t.invalid"}'', true); set local role authenticated;'
\set as_anon 'select set_config(''request.jwt.claims'', '''', true); set local role anon;'

begin;

create function test.errmsg(q text) returns text language plpgsql as $$ begin execute q; return null; exception when others then return sqlerrm; end $$;
create function test.has(msg text, pat text, label text) returns void language plpgsql as $$ begin if msg is null or msg not like pat then raise exception 'FALHOU: % — esperado %, veio %', label, pat, coalesce(msg, '(sem erro)'); end if; end $$;
create function test.t(k text) returns uuid language sql as $$ select current_setting('t.' || k)::uuid $$;
create function test.at(d date, hhmm text) returns timestamptz language sql immutable as $$ select (d + hhmm::time) at time zone 'America/Sao_Paulo' $$;
create function test.day(n integer) returns date language sql stable security definer set search_path = '' as $$ select private.ag_today(current_setting('t.org')::uuid) + n $$;
create function test.tok() returns text language sql volatile as $$ select replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '') $$;
grant execute on all functions in schema test to anon, authenticated;

insert into auth.users (id, email) values ('ffffffff-0000-4000-8000-0000000000d0', 'od@t.invalid'), ('ffffffff-0000-4000-8000-0000000000d1', 'md@t.invalid'), ('ffffffff-0000-4000-8000-0000000000d2', 'vd@t.invalid');

-- ===================================================================== (1) empresa
:as_od
do $$
declare org uuid;
begin
  org := public.create_organization('Regras do Motor', 'regras-motor');
  perform set_config('t.org', org::text, true);
  insert into public.organization_members (organization_id, user_id, role) values
    (org, 'ffffffff-0000-4000-8000-0000000000d1', 'member'), (org, 'ffffffff-0000-4000-8000-0000000000d2', 'viewer');
  perform set_config('t.profA', public.ag_save_professional(org, null, 'Ana Regras', null, '#2563eb', true, null)::text, true);
  perform set_config('t.profX', public.ag_save_professional(org, null, 'Xavier Inativo', null, '#111111', false, null)::text, true);
  perform set_config('t.s1', public.ag_save_service(org, null, 'Corte', null, 30, 0, 0, 5000, true, true)::text, true);
  perform public.ag_set_professional_services(org, test.t('profA'), array[test.t('s1')]);
  perform public.ag_set_professional_services(org, test.t('profX'), array[test.t('s1')]);
  perform public.ag_save_weekly(org, test.t('profA'), (select jsonb_agg(x) from (
    select jsonb_build_object('weekday', d, 'start', '09:00', 'end', '12:00') x from generate_series(0, 6) d
    union all select jsonb_build_object('weekday', d, 'start', '13:00', 'end', '18:00') from generate_series(0, 6) d) q));
  perform public.ag_save_weekly(org, test.t('profX'), (select jsonb_agg(jsonb_build_object('weekday', d, 'start', '09:00', 'end', '12:00')) from generate_series(0, 6) d));
  perform public.ag_save_settings(org, '{"public_booking_enabled":true,"minimum_notice_minutes":120,"booking_horizon_days":30,"slot_step_minutes":30}');
  raise notice 'PASS: empresa de teste (1)';
end $$;
reset role;

-- ===================================================================== (2) profissional inativo não recebe horários
do $$
declare org uuid := test.t('org');
begin
  perform test.has(private.ag_check_slot(org, test.t('profX'), test.t('s1'), test.at(test.day(3), '10:00'), false), 'professional', 'profissional inativo');
  assert private.ag_check_slot(org, test.t('profA'), test.t('s1'), test.at(test.day(3), '10:00'), false) is null, 'profissional ativo no mesmo horário está livre';
  assert (select count(*) from private.ag_list_slots(org, test.t('profX'), test.t('s1'), test.day(3), test.day(3), false)) = 0, 'lista vazia para profissional inativo';
  raise notice 'PASS: profissional inativo (2)';
end $$;

-- ===================================================================== (3) conflito, adjacência e a própria ocupação na remarcação
:as_od
do $$ begin perform set_config('t.blk', public.ag_create_block(test.t('org'), test.t('profA'), test.at(test.day(3), '10:00'), test.at(test.day(3), '11:00'), 'reunião')::text, true); end $$;
reset role;
do $$
declare org uuid := test.t('org'); a uuid := test.t('profA'); s uuid := test.t('s1'); d date := test.day(3); blk uuid;
begin
  select id into blk from public.schedule_entries where professional_id = a and kind = 'block';
  perform test.has(private.ag_check_slot(org, a, s, test.at(d, '10:30'), false), 'conflict', 'dentro do bloqueio');
  assert private.ag_check_slot(org, a, s, test.at(d, '11:00'), false) is null, 'adjacente ao fim do bloqueio é permitido';
  assert private.ag_check_slot(org, a, s, test.at(d, '09:30'), false) is null, 'adjacente ao início do bloqueio é permitido';
  assert private.ag_check_slot(org, a, s, test.at(d, '10:30'), false, blk) is null, 'ignorando a própria ocupação o horário está livre (remarcação)';
  assert (select count(*) from private.ag_list_slots(org, a, s, d, d, false) where starts_at = test.at(d, '10:30')) = 0, 'a lista não oferece horário dentro do bloqueio';
  assert (select count(*) from private.ag_list_slots(org, a, s, d, d, false) where starts_at = test.at(d, '11:00')) = 1, 'a lista oferece o horário adjacente';
  assert (select count(*) from private.ag_list_slots(org, a, s, d, d, false, null, null, null, blk) where starts_at = test.at(d, '10:30')) = 1, 'a lista da remarcação inclui o horário da própria ocupação';
  -- ignorar OUTRA ocupação não libera o horário: só a própria é desconsiderada
  perform test.has(private.ag_check_slot(org, a, s, test.at(d, '10:30'), false, gen_random_uuid()), 'conflict', 'ignorar outra ocupação não libera o bloqueio');
  assert (select count(*) from private.ag_list_slots(org, a, s, d, d, false, null, null, null, gen_random_uuid()) where starts_at = test.at(d, '10:30')) = 0, 'a lista da remarcação continua sem o horário bloqueado por outra ocupação';
  raise notice 'PASS: conflito, adjacência e remarcação (3)';
end $$;

-- ===================================================================== (4) teto de 62 dias e (5) nada no passado
do $$
declare org uuid := test.t('org'); a uuid := test.t('profA'); s uuid := test.t('s1');
begin
  assert (select count(distinct local_date) from private.ag_list_slots(org, a, s, test.day(1), test.day(1) + 400, false)) = 63, 'período limitado a 62 dias depois da data inicial (63 datas)';
  assert (select max(local_date) from private.ag_list_slots(org, a, s, test.day(1), test.day(1) + 400, false)) = test.day(1) + 62, 'última data = inicial + 62';
  assert (select count(*) from private.ag_list_slots(org, a, s, test.day(-1), test.day(0), false) where starts_at <= now()) = 0, 'nenhum horário no passado';
  assert (select count(*) from private.ag_list_slots(org, a, s, test.day(-1), test.day(-1), false)) = 0, 'o dia de ontem inteiro já passou';
  raise notice 'PASS: teto de 62 dias e passado (4, 5)';
end $$;

-- ===================================================================== (6) regra semanal desativada não vale
do $$
declare org uuid := test.t('org'); a uuid := test.t('profA'); s uuid := test.t('s1'); d date := test.day(2);
begin
  assert (select count(*) from private.ag_list_slots(org, a, s, d, d, false)) > 0, 'há horários antes de desativar';
  update public.availability_rules set active = false where professional_id = a and weekday = extract(dow from d)::integer;
  assert (select count(*) from private.ag_list_slots(org, a, s, d, d, false)) = 0, 'regra desativada não gera horários';
  perform test.has(private.ag_check_slot(org, a, s, test.at(d, '10:00'), false), 'outside', 'regra desativada = fora do expediente');
  update public.availability_rules set active = true where professional_id = a and weekday = extract(dow from d)::integer;
  raise notice 'PASS: regra desativada (6)';
end $$;

-- ===================================================================== (7) telefone: dígitos de menos ou demais
do $$
begin
  perform test.has(test.errmsg($q$select private.ag_clean_phone('--------')$q$), '%telefone inválido%', 'só pontuação');
  perform test.has(test.errmsg($q$select private.ag_clean_phone('1234567890123456')$q$), '%telefone inválido%', '16 dígitos');
  perform test.has(test.errmsg($q$select private.ag_clean_phone('(11) 9')$q$), '%telefone inválido%', 'curto demais');
  assert private.ag_clean_phone('(11) 91234-5678') = '(11) 91234-5678', 'telefone válido passa intacto';
  raise notice 'PASS: telefone (7)';
end $$;

-- ===================================================================== (8) limite de abuso por empresa (chamada pública)
do $$
begin
  insert into public.booking_rate_limits (bucket, window_start, hits)
  values ('book:org:' || test.t('org')::text, to_timestamp(floor(extract(epoch from now()) / 600) * 600), 120)
  on conflict (bucket, window_start) do update set hits = 120;
end $$;
:as_anon
do $$
begin
  perform test.has(test.errmsg(format($q$select public.ag_public_book('regras-motor', %L, %L, %L, 'Fulano Teste', '11 91234-5678', null, true, gen_random_uuid(), test.tok(), null)$q$,
    test.t('s1'), test.t('profA'), test.at(test.day(5), '10:00'))), '%Muitas tentativas%', 'teto por empresa');
  raise notice 'PASS: limite por empresa (8)';
end $$;
reset role;
delete from public.booking_rate_limits where bucket = 'book:org:' || current_setting('t.org');

-- ===================================================================== (9) reserva encerrada não oferece horários ao link
:as_anon
do $$
declare r jsonb; tk text := test.tok();
begin
  r := public.ag_public_book('regras-motor', test.t('s1'), test.t('profA'), test.at(test.day(5), '10:00'), 'Fulano Teste', '11 91234-5678', null, true, gen_random_uuid(), tk, null);
  assert r is not null, 'reserva pública criada';
  perform set_config('t.tok', tk, true);
  assert public.ag_public_booking_slots(tk, test.day(5), test.day(7)) is not null, 'reserva ativa: o link recebe horários para remarcar';
  perform public.ag_public_cancel(tk);
  assert public.ag_public_booking_slots(tk, test.day(5), test.day(7)) is null, 'reserva cancelada: nenhum horário é oferecido';
  assert public.ag_public_get_booking(tk) is not null, 'o link continua mostrando a reserva (Cancelada)';
  raise notice 'PASS: reserva encerrada (9)';
end $$;
reset role;

-- ===================================================================== (10) quem não tem perfil na agenda não muda estado de atendimento
:as_od
do $$ begin perform set_config('t.ap', public.ag_create_appointment(test.t('org'), test.t('profA'), test.t('s1'), null, '{"name":"Cliente Um","phone":"(11) 91234-5678"}', test.at(test.day(4), '10:00'), null)::text, true); end $$;
reset role;
:as_vd
do $$
begin
  assert private.ag_profile(test.t('org')) is null, 'leitor não tem perfil na agenda';
  perform test.has(test.errmsg(format($q$select public.ag_set_status(%L, %L, 'cancel', null)$q$, test.t('org'), test.t('ap'))), '%sem permissão%', 'leitor não cancela');
  perform test.has(test.errmsg(format($q$select public.ag_update_notes(%L, %L, 'x')$q$, test.t('org'), test.t('ap'))), '%sem permissão%', 'leitor não altera notas');
  raise notice 'PASS: leitor sem perfil (10)';
end $$;
reset role;
:as_md
do $$
begin
  assert private.ag_profile(test.t('org')) is null, 'membro sem vínculo a profissional não tem perfil';
  perform test.has(test.errmsg(format($q$select public.ag_set_status(%L, %L, 'cancel', null)$q$, test.t('org'), test.t('ap'))), '%sem permissão%', 'membro sem vínculo não cancela');
  assert (select count(*) from public.appointments) = 0 and (select count(*) from public.customers) = 0, 'membro sem vínculo não enxerga atendimentos nem clientes';
  raise notice 'PASS: membro sem vínculo (10)';
end $$;
reset role;
do $$ begin assert (select status from public.appointments where id = test.t('ap')) = 'scheduled', 'o atendimento permaneceu agendado'; end $$;

rollback;
