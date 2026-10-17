-- Agendamento Online — fuso horário da empresa (horário de verão: hora inexistente e hora repetida) e painel operacional com dados reais.

\set as_od 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000d0","aal":"aal2","email":"od@t.invalid"}'', true); set local role authenticated;'
\set as_pd 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000d1","aal":"aal1","email":"pd@t.invalid"}'', true); set local role authenticated;'

begin;

create function test.errmsg(q text) returns text language plpgsql as $$ begin execute q; return null; exception when others then return sqlerrm; end $$;
create function test.has(msg text, pat text, label text) returns void language plpgsql as $$ begin if msg is null or msg not like pat then raise exception 'FALHOU: % — esperado %, veio %', label, pat, coalesce(msg, '(sem erro)'); end if; end $$;
create function test.t(k text) returns uuid language sql as $$ select current_setting('t.' || k)::uuid $$;
create function test.sql(q text) returns void language plpgsql security definer set search_path = '' as $$ begin execute q; end $$;
-- horários (UTC, «HH:MM») dos horários livres de um dia local, na ordem
create function test.slots_utc(prof uuid, svc uuid, d date) returns text[] language sql stable as $$
  select array_agg(to_char((x ->> 'at')::timestamptz at time zone 'UTC', 'HH24:MI') order by (x ->> 'at')::timestamptz)
  from jsonb_array_elements(public.ag_slots(current_setting('t.org')::uuid, prof, svc, d, d)) x;
$$;
grant execute on all functions in schema test to anon, authenticated;

insert into auth.users (id, email) values ('ffffffff-0000-4000-8000-0000000000d0', 'od@t.invalid'), ('ffffffff-0000-4000-8000-0000000000d1', 'pd@t.invalid');

-- ===================================================================== (1) fuso America/New_York: salto de março (02:00 → 03:00) e volta de novembro (02:00 → 01:00)
:as_od
do $$
declare org uuid; pr uuid; sv uuid;
begin
  org := public.create_organization('Studio Nova York', 'studio-ny');
  perform set_config('t.org', org::text, true);
  insert into public.organization_members (organization_id, user_id, role) values (org, 'ffffffff-0000-4000-8000-0000000000d1', 'member');
  perform public.ag_save_settings(org, '{"timezone":"America/New_York"}');
  assert private.ag_tz(org) = 'America/New_York', 'fuso da empresa';
  perform test.has(test.errmsg(format($q$select public.ag_save_settings(%L, '{"timezone":"Marte/Olympus"}')$q$, org)), '%fuso horário inválido%', 'fuso inexistente é recusado');
  pr := public.ag_save_professional(org, null, 'Pat Fuso', null, '#2563eb', true, null);
  sv := public.ag_save_service(org, null, 'Sessão', null, 30, 0, 0, null, true, true);
  perform public.ag_set_professional_services(org, pr, array[sv]);
  perform set_config('t.pr', pr::text, true); perform set_config('t.sv', sv::text, true);

  -- (a) domingo 2027-03-14 (salto): janela local 01:00–05:00 dura 3 h reais. Não existe 02:00–02:59.
  perform public.ag_save_weekly(org, pr, '[{"weekday":0,"start":"01:00","end":"05:00"}]');
  assert test.slots_utc(pr, sv, date '2027-03-14') = array['06:00', '06:30', '07:00', '07:30', '08:00', '08:30'],
    'salto: 01:00, 01:30, 03:00, 03:30, 04:00, 04:30 locais (sem 02:xx) = ' || array_to_string(test.slots_utc(pr, sv, date '2027-03-14'), ',');
  -- (b) início da janela dentro do salto (02:30 não existe): é deslocado para frente → 03:30 local (07:30 UTC); fim 04:00 local (08:00 UTC)
  perform public.ag_save_weekly(org, pr, '[{"weekday":0,"start":"02:30","end":"04:00"}]');
  assert test.slots_utc(pr, sv, date '2027-03-14') = array['07:30'], 'início inexistente desloca para frente: ' || coalesce(array_to_string(test.slots_utc(pr, sv, date '2027-03-14'), ','), 'vazio');
  -- (c) domingo 2027-11-07 (volta): janela 00:30–03:00 dura 3,5 h reais; 01:00–01:59 acontece duas vezes e AMBAS são oferecidas (instantes distintos)
  perform public.ag_save_weekly(org, pr, '[{"weekday":0,"start":"00:30","end":"03:00"}]');
  assert test.slots_utc(pr, sv, date '2027-11-07') = array['04:30', '05:00', '05:30', '06:00', '06:30', '07:00', '07:30'],
    'volta: 7 horários reais = ' || array_to_string(test.slots_utc(pr, sv, date '2027-11-07'), ',');
  -- (d) início ambíguo (01:30 ocorre duas vezes): vale a ocorrência POSTERIOR (horário padrão), como documentado
  perform public.ag_save_weekly(org, pr, '[{"weekday":0,"start":"01:30","end":"03:00"}]');
  assert (test.slots_utc(pr, sv, date '2027-11-07'))[1] = '06:30', 'início ambíguo usa a ocorrência posterior';
  -- (e) dia comum, sem horário de verão em jogo: 09:00 local = 14:00 UTC (inverno)
  perform public.ag_save_weekly(org, pr, '[{"weekday":1,"start":"09:00","end":"10:00"}]');
  assert test.slots_utc(pr, sv, date '2027-01-11') = array['14:00', '14:30'], 'inverno: UTC−5';
  assert test.slots_utc(pr, sv, date '2027-07-12') = array['13:00', '13:30'], 'verão: UTC−4 (a mesma regra local, instantes diferentes)';
  raise notice 'PASS: fuso da empresa, salto e volta do horário de verão (1)';
end $$;
reset role;

-- ===================================================================== (2) painel operacional
:as_od
do $$
declare org uuid := test.t('org'); pr uuid := test.t('pr'); sv uuid := test.t('sv'); pr2 uuid; c uuid;
begin
  perform public.ag_save_settings(org, '{"timezone":"America/Sao_Paulo"}');
  pr2 := public.ag_save_professional(org, null, 'Dani Dois', null, '#16a34a', true, 'ffffffff-0000-4000-8000-0000000000d1');
  perform set_config('t.pr2', pr2::text, true);
  perform public.ag_set_professional_services(org, pr2, array[sv]);
  c := public.ag_save_customer(org, null, 'Cliente Painel', null, '(11) 95555-4444');
  perform set_config('t.cust', c::text, true);
end $$;
reset role;
-- dados diretos (como histórico): 2 concluídos e 1 não compareceu ontem (Pat), 1 cancelado ontem (Pat), 1 pendente e 1 confirmado no futuro (Pat), 1 concluído ontem (Dani), 1 de hoje (Pat)
do $$
declare org uuid := test.t('org'); c uuid := test.t('cust'); sv uuid := test.t('sv'); spec record; e uuid;
begin
  for spec in
    select * from (values
      ('pr', now() - interval '1 day 5 hours', 'completed'), ('pr', now() - interval '1 day 4 hours', 'completed'), ('pr', now() - interval '1 day 3 hours', 'no_show'),
      ('pr', now() - interval '1 day 2 hours', 'cancelled'), ('pr', now() + interval '1 day', 'scheduled'), ('pr', now() + interval '1 day 2 hours', 'confirmed'),
      ('pr2', now() - interval '1 day 6 hours', 'completed'), ('pr', now() + interval '1 second', 'scheduled')) v(who, start_at, st)
  loop
    insert into public.schedule_entries (organization_id, professional_id, kind, occupied_start_at, occupied_end_at, active)
    values (org, test.t(spec.who), 'appointment', spec.start_at, spec.start_at + interval '30 minutes', spec.st <> 'cancelled') returning id into e;
    insert into public.appointments (organization_id, schedule_entry_id, professional_id, customer_id, service_id, starts_at, ends_at, status, source, service_name_snapshot, duration_minutes_snapshot, buffer_before_minutes_snapshot, buffer_after_minutes_snapshot)
    values (org, e, test.t(spec.who), c, sv, spec.start_at, spec.start_at + interval '30 minutes', spec.st, 'admin', 'Sessão', 30, 0, 0);
  end loop;
end $$;

:as_od
do $$
declare org uuid := test.t('org'); d jsonb; today date := private.ag_today(test.t('org'));
begin
  d := public.ag_dashboard(org, today - 3, today + 3, null);
  assert (d ->> 'completed')::int = 3 and (d ->> 'no_show')::int = 1 and (d ->> 'cancelled')::int = 1, 'concluídos, não comparecimentos e cancelados do período';
  assert (d ->> 'no_show_rate')::numeric = 25.0, 'taxa de não comparecimento = 1 / (3 + 1) = 25%';
  assert (d ->> 'pending_confirmation')::int = 2, 'pendentes de confirmação (agendados e futuros)';
  assert (d ->> 'today_count')::int >= 1, 'atendimentos de hoje (não cancelados)';
  assert jsonb_array_length(d -> 'upcoming') = 3, 'próximos atendimentos ativos';
  assert (d -> 'by_status' ->> 'completed')::int = 3 and (d -> 'by_status' ->> 'cancelled')::int = 1, 'distribuição por status';
  assert (select sum((x ->> 'count')::int) from jsonb_array_elements(d -> 'by_professional') x) = 7, 'volume por profissional exclui cancelados';
  assert d -> 'by_service' -> 0 ->> 'name' = 'Sessão', 'serviços mais agendados';
  -- profissional filtrado
  d := public.ag_dashboard(org, today - 3, today + 3, test.t('pr2'));
  assert (d ->> 'completed')::int = 1 and (d ->> 'no_show')::int = 0 and (d ->> 'no_show_rate')::numeric = 0.0, 'filtro por profissional';
  -- sem concluídos nem faltas: denominador zero → sem taxa (a tela mostra «Sem dados»)
  d := public.ag_dashboard(org, today + 10, today + 20, null);
  assert d -> 'no_show_rate' = 'null'::jsonb, 'sem dados: taxa nula, nunca 0%';
  perform test.has(test.errmsg(format($q$select public.ag_dashboard(%L, current_date, current_date - 1, null)$q$, org)), '%período inválido%', 'período invertido');
  raise notice 'PASS: painel com dados reais (2)';
end $$;
reset role;

:as_pd
do $$
declare org uuid := test.t('org'); d jsonb; today date := private.ag_today(test.t('org'));
begin
  d := public.ag_dashboard(org, today - 3, today + 3, null);
  assert (d ->> 'completed')::int = 1 and (d ->> 'cancelled')::int = 0 and (d ->> 'no_show')::int = 0, 'profissional vê só os próprios números (RLS), mesmo sem filtro';
  assert (select coalesce(sum((x ->> 'count')::int), 0) from jsonb_array_elements(d -> 'by_professional') x) = 1, 'volume só dele';
  raise notice 'PASS: painel respeita as permissões (3)';
end $$;
reset role;

rollback;
