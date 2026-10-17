-- Agendamento Online — SEGURANÇA: RLS em todas as tabelas, nenhuma escrita direta (INSERT/UPDATE/DELETE negados a todos os papéis),
-- leitura por perfil (SELECT), usuário de fora, funções SECURITY DEFINER com search_path fixo e superfície mínima do papel anon.

\set as_oe 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000e0","aal":"aal2","email":"oe@t.invalid"}'', true); set local role authenticated;'
\set as_me 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000e1","aal":"aal1","email":"me@t.invalid"}'', true); set local role authenticated;'
\set as_pe 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000e2","aal":"aal1","email":"pe@t.invalid"}'', true); set local role authenticated;'
\set as_ve 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000e3","aal":"aal1","email":"ve@t.invalid"}'', true); set local role authenticated;'
\set as_xe 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000e4","aal":"aal1","email":"xe@t.invalid"}'', true); set local role authenticated;'
\set as_oe_nomfa 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000e0","aal":"aal1","email":"oe@t.invalid"}'', true); set local role authenticated;'

begin;

create function test.errmsg(q text) returns text language plpgsql as $$ begin execute q; return null; exception when others then return sqlerrm; end $$;
create function test.has(msg text, pat text, label text) returns void language plpgsql as $$ begin if msg is null or msg not like pat then raise exception 'FALHOU: % — esperado %, veio %', label, pat, coalesce(msg, '(sem erro)'); end if; end $$;
create function test.t(k text) returns uuid language sql as $$ select current_setting('t.' || k)::uuid $$;
grant execute on all functions in schema test to anon, authenticated;

insert into auth.users (id, email) values
  ('ffffffff-0000-4000-8000-0000000000e0', 'oe@t.invalid'), ('ffffffff-0000-4000-8000-0000000000e1', 'me@t.invalid'), ('ffffffff-0000-4000-8000-0000000000e2', 'pe@t.invalid'),
  ('ffffffff-0000-4000-8000-0000000000e3', 've@t.invalid'), ('ffffffff-0000-4000-8000-0000000000e4', 'xe@t.invalid');

:as_oe
do $$
declare org uuid; pr uuid; sv uuid; dd date;
begin
  org := public.create_organization('Segurança Teste', 'seguranca-teste');
  perform set_config('t.org', org::text, true);
  insert into public.organization_members (organization_id, user_id, role) values
    (org, 'ffffffff-0000-4000-8000-0000000000e1', 'manager'), (org, 'ffffffff-0000-4000-8000-0000000000e2', 'member'), (org, 'ffffffff-0000-4000-8000-0000000000e3', 'viewer');
  pr := public.ag_save_professional(org, null, 'Profissional Seg', null, '#2563eb', true, 'ffffffff-0000-4000-8000-0000000000e2');
  sv := public.ag_save_service(org, null, 'Serviço Seg', null, 30, 0, 0, null, true, true);
  perform public.ag_set_professional_services(org, pr, array[sv]);
  perform public.ag_save_weekly(org, pr, (select jsonb_agg(jsonb_build_object('weekday', d, 'start', '09:00', 'end', '18:00')) from generate_series(0, 6) d));
  dd := private.ag_today(org) + 3;
  perform public.ag_create_appointment(org, pr, sv, null, '{"name":"Cliente Seg","phone":"(11) 93333-2222"}', (dd + time '10:00') at time zone 'America/Sao_Paulo', 'nota interna secreta');
  perform set_config('t.pr', pr::text, true);
end $$;
reset role;

-- ===================================================================== (1) RLS ligada em todas as tabelas; ninguém escreve direto; leitura só onde há política
do $$
declare t text; n integer := 0;
begin
  foreach t in array array['scheduling_settings', 'professionals', 'services', 'professional_services', 'availability_rules', 'availability_overrides', 'customers', 'schedule_entries',
    'appointments', 'appointment_events', 'booking_management_tokens', 'public_booking_requests', 'booking_rate_limits'] loop
    assert (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass), 'RLS ligada em ' || t;
    n := n + 1;
  end loop;
  assert n = 13, 'todas as tabelas do sistema conferidas';
  -- nenhuma tabela concede escrita a anon ou authenticated
  assert not exists (select 1 from information_schema.role_table_grants g where g.table_schema = 'public' and g.grantee in ('anon', 'authenticated')
    and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
    and g.table_name in ('scheduling_settings', 'professionals', 'services', 'professional_services', 'availability_rules', 'availability_overrides', 'customers', 'schedule_entries',
      'appointments', 'appointment_events', 'booking_management_tokens', 'public_booking_requests', 'booking_rate_limits')), 'sem privilégio de escrita direta';
  -- tabelas sensíveis sem leitura direta para ninguém
  assert not exists (select 1 from information_schema.role_table_grants g where g.table_schema = 'public' and g.grantee in ('anon', 'authenticated') and g.privilege_type = 'SELECT'
    and g.table_name in ('booking_management_tokens', 'public_booking_requests', 'booking_rate_limits')), 'tokens, idempotência e limites não são legíveis';
  assert not exists (select 1 from information_schema.role_table_grants g where g.table_schema = 'public' and g.grantee = 'anon' and g.table_name in (
    'scheduling_settings', 'professionals', 'services', 'professional_services', 'availability_rules', 'availability_overrides', 'customers', 'schedule_entries', 'appointments', 'appointment_events')), 'anon não lê nenhuma tabela';
  raise notice 'PASS: RLS e privilégios das tabelas (1)';
end $$;

:as_oe
do $$
declare t text; pol record; msg text;
begin
  -- nem o proprietário (AAL2) escreve direto: precisa passar pelas funções
  foreach t in array array['scheduling_settings', 'professionals', 'services', 'professional_services', 'availability_rules', 'availability_overrides', 'customers', 'schedule_entries', 'appointments', 'appointment_events'] loop
    msg := test.errmsg(format('insert into public.%I default values', t));
    perform test.has(msg, '%permission denied%', 'INSERT direto negado em ' || t);
    msg := test.errmsg(format('delete from public.%I', t));
    perform test.has(msg, '%permission denied%', 'DELETE direto negado em ' || t);
  end loop;
  perform test.has(test.errmsg('update public.appointments set status = ''completed'''), '%permission denied%', 'UPDATE direto negado em appointments');
  perform test.has(test.errmsg('update public.scheduling_settings set public_booking_enabled = true'), '%permission denied%', 'UPDATE direto negado em scheduling_settings');
  perform test.has(test.errmsg('update public.customers set name = ''x'''), '%permission denied%', 'UPDATE direto negado em customers');
  perform test.has(test.errmsg('select count(*) from public.booking_management_tokens'), '%permission denied%', 'tokens ilegíveis');
  perform test.has(test.errmsg('select count(*) from public.booking_rate_limits'), '%permission denied%', 'limites ilegíveis');
  raise notice 'PASS: nem o proprietário escreve direto nas tabelas (2)';
end $$;
reset role;

-- ===================================================================== (3) leitura por perfil
:as_me
do $$
begin
  assert (select count(*) from public.appointments) = 1 and (select count(*) from public.customers) = 1 and (select count(*) from public.professionals) = 1, 'gestor lê a operação';
  assert (select internal_notes from public.appointments limit 1) = 'nota interna secreta', 'gestor lê as notas internas';
end $$;
reset role;
:as_pe
do $$
begin
  assert (select count(*) from public.appointments) = 1 and (select count(*) from public.customers) = 1, 'profissional vê o próprio atendimento e o cliente dele';
  assert (select count(*) from public.scheduling_settings) = 1, 'profissional lê as políticas (para exibir regras)';
  assert (select count(*) from public.appointment_events) >= 1, 'profissional lê o histórico do próprio atendimento';
end $$;
reset role;
:as_ve
do $$
begin
  assert (select count(*) from public.appointments) = 0 and (select count(*) from public.customers) = 0 and (select count(*) from public.services) = 0
    and (select count(*) from public.scheduling_settings) = 0 and (select count(*) from public.appointment_events) = 0, 'leitor não lê nada';
end $$;
reset role;
:as_xe
do $$
begin
  assert (select count(*) from public.appointments) = 0 and (select count(*) from public.customers) = 0 and (select count(*) from public.professionals) = 0, 'quem não é membro não lê nada';
  perform test.has(test.errmsg(format($q$select public.ag_slots(%L, %L, gen_random_uuid(), current_date, current_date)$q$, test.t('org'), test.t('pr'))), '%sem permissão%', 'não-membro não chama funções da empresa');
  perform test.has(test.errmsg(format($q$select public.ag_dashboard(%L, current_date, current_date, null)$q$, test.t('org'))), '%sem permissão%', 'não-membro não lê o painel');
  raise notice 'PASS: leitura por perfil (3)';
end $$;
reset role;

-- ===================================================================== (4) MFA: proprietário sem segundo fator não escreve (nem via função)
:as_oe_nomfa
do $$
begin
  perform test.has(test.errmsg(format($q$select public.ag_save_service(%L, null, 'Sem MFA', null, 30, 0, 0, null, true, true)$q$, test.t('org'))), '%duas etapas%', 'escrita exige AAL2 para o proprietário');
  raise notice 'PASS: segundo fator exigido (4)';
end $$;
reset role;

-- ===================================================================== (5) funções: search_path fixo e superfície mínima
do $$
declare f record; n integer := 0;
begin
  for f in select p.oid, p.proname, p.prosecdef, p.proconfig, n.nspname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname in ('public', 'private') and p.proname like 'ag\_%' loop
    n := n + 1;
    if f.prosecdef then
      assert f.proconfig is not null and exists (select 1 from unnest(f.proconfig) c where c in ('search_path=""', 'search_path=')), 'search_path fixo em ' || f.nspname || '.' || f.proname;
    end if;
    -- anon só executa operações públicas
    if has_function_privilege('anon', f.oid, 'execute') and f.proname not like 'ag\_public\_%' then
      raise exception 'anon executa %.% (deveria ser só ag_public_*)', f.nspname, f.proname;
    end if;
    -- funções internas nunca são chamáveis por usuários (exceto os helpers de RLS e o guard, que precisam avaliar políticas)
    if f.nspname = 'private' and has_function_privilege('authenticated', f.oid, 'execute')
       and f.proname not in ('ag_role', 'ag_my_professional', 'ag_profile', 'ag_is_owner', 'ag_is_manager', 'ag_customer_visible', 'ag_appt_visible', 'ag_guard', 'ag_tz', 'ag_today') then
      raise exception 'authenticated executa private.% sem necessidade', f.proname;
    end if;
  end loop;
  assert n >= 40, 'funções do sistema conferidas (' || n || ')';
  assert (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'ag\_public\_%' and has_function_privilege('anon', p.oid, 'execute')) = 8, 'exatamente 8 operações públicas (página, logotipo, horários, reservar, consultar, cancelar, horários do link, remarcar)';
  raise notice 'PASS: funções com search_path fixo e superfície mínima para anon (5)';
end $$;

rollback;
