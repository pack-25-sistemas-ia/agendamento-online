-- Agendamento Online — operações PÚBLICAS (papel anon): página, horários, reserva idempotente, link seguro (cancelar/remarcar), tokens, limites de abuso e vazamento.

\set as_oc 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000c0","aal":"aal2","email":"oc@t.invalid"}'', true); set local role authenticated;'
\set as_mc 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000c1","aal":"aal1","email":"mc@t.invalid"}'', true); set local role authenticated;'
\set as_anon 'select set_config(''request.jwt.claims'', '''', true); set local role anon;'

begin;

create function test.errmsg(q text) returns text language plpgsql as $$ begin execute q; return null; exception when others then return sqlerrm; end $$;
create function test.has(msg text, pat text, label text) returns void language plpgsql as $$ begin if msg is null or msg not like pat then raise exception 'FALHOU: % — esperado %, veio %', label, pat, coalesce(msg, '(sem erro)'); end if; end $$;
create function test.t(k text) returns uuid language sql as $$ select current_setting('t.' || k)::uuid $$;
create function test.sql(q text) returns void language plpgsql security definer set search_path = '' as $$ begin execute q; end $$;
create function test.cnt(q text) returns bigint language plpgsql security definer set search_path = '' as $$ declare n bigint; begin execute q into n; return n; end $$;
create function test.txt(q text) returns text language plpgsql security definer set search_path = '' as $$ declare s text; begin execute q into s; return s; end $$;
create function test.at(d date, hhmm text) returns timestamptz language sql immutable as $$ select (d + hhmm::time) at time zone 'America/Sao_Paulo' $$;
create function test.day(n integer) returns date language sql stable security definer set search_path = '' as $$ select private.ag_today(current_setting('t.org')::uuid) + n $$;
create function test.tok() returns text language sql volatile as $$ select replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '') $$;
grant execute on all functions in schema test to anon, authenticated;

insert into auth.users (id, email) values ('ffffffff-0000-4000-8000-0000000000c0', 'oc@t.invalid'), ('ffffffff-0000-4000-8000-0000000000c1', 'mc@t.invalid');

-- ===================================================================== (1) empresa com página pública
:as_oc
do $$
declare org uuid;
begin
  org := public.create_organization('Salão Público Ltda', 'salao-publico');
  perform set_config('t.org', org::text, true);
  insert into public.organization_members (organization_id, user_id, role) values (org, 'ffffffff-0000-4000-8000-0000000000c1', 'manager');
  perform set_config('t.profA', public.ag_save_professional(org, null, 'Ana Cabeleireira', 'Dez anos de experiência', '#2563eb', true, null)::text, true);
  perform set_config('t.profX', public.ag_save_professional(org, null, 'Xavier Inativo', null, '#111111', false, null)::text, true);
  perform set_config('t.s1', public.ag_save_service(org, null, 'Corte', 'Corte simples', 30, 0, 0, 5000, true, true)::text, true);
  perform set_config('t.s2', public.ag_save_service(org, null, 'Serviço interno', null, 30, 0, 0, null, true, false)::text, true);
  perform public.ag_set_professional_services(org, test.t('profA'), array[test.t('s1'), test.t('s2')]);
  perform public.ag_set_professional_services(org, test.t('profX'), array[test.t('s1')]);
  perform public.ag_save_weekly(org, test.t('profA'), (select jsonb_agg(x) from (
    select jsonb_build_object('weekday', d, 'start', '09:00', 'end', '12:00') x from generate_series(0, 6) d
    union all select jsonb_build_object('weekday', d, 'start', '13:00', 'end', '18:00') from generate_series(0, 6) d) q));
  perform public.ag_save_weekly(org, test.t('profX'), '[{"weekday":1,"start":"09:00","end":"12:00"}]');
  perform public.ag_save_settings(org, '{"public_display_name":"Salão da Ana","public_description":"Cortes e coloração","public_contact":"(11) 4002-8922","booking_policy_text":"Cancelamentos até 24h antes.","minimum_notice_minutes":120,"booking_horizon_days":30,"slot_step_minutes":30,"customer_cancellation_notice_minutes":1440,"customer_rescheduling_notice_minutes":1440}');
  raise notice 'PASS: empresa de teste (1)';
end $$;
reset role;

-- ===================================================================== (2) página pública: só o que deve aparecer
:as_anon
do $$
declare p jsonb;
begin
  assert public.ag_public_page('salao-publico') is null, 'página desligada não existe';
  assert public.ag_public_slots('salao-publico', test.t('s1'), test.t('profA'), current_date, current_date + 3) is null, 'horários de página desligada também não';
  perform test.has(test.errmsg(format($q$select public.ag_public_book('salao-publico', %L, %L, now() + interval '3 days', 'Fulano Teste', '11 91234-5678', null, true, gen_random_uuid(), test.tok(), null)$q$, test.t('s1'), test.t('profA'))), '%indisponível%', 'não reserva em página desligada');
  raise notice 'PASS: página desligada não expõe nada (2)';
end $$;
reset role;

:as_oc
do $$ begin perform public.ag_save_settings(test.t('org'), '{"public_booking_enabled":true}'); end $$;
reset role;

:as_anon
do $$
declare p jsonb; txt text;
begin
  p := public.ag_public_page('SALAO-PUBLICO');
  assert p is not null and p ->> 'name' = 'Salão da Ana' and p ->> 'timezone' = 'America/Sao_Paulo', 'página pública ligada (slug sem diferenciar maiúsculas)';
  assert jsonb_array_length(p -> 'services') = 1 and p -> 'services' -> 0 ->> 'name' = 'Corte', 'só serviços públicos e ativos';
  assert jsonb_array_length(p -> 'services' -> 0 -> 'professionals') = 1 and p -> 'services' -> 0 -> 'professionals' -> 0 ->> 'name' = 'Ana Cabeleireira', 'só profissionais ativos';
  txt := p::text;
  assert txt !~* 'organization_id|linked_user|internal|notes|logo_path|block_reason|email', 'nada administrativo na página pública';
  assert not (txt like '%' || test.t('org')::text || '%'), 'o id da empresa não aparece';
  assert public.ag_public_page('nao-existe') is null and public.ag_public_page('') is null and public.ag_public_page(null) is null, 'slug inexistente';
  raise notice 'PASS: página pública mostra só dados públicos (3)';
end $$;
reset role;

-- ===================================================================== (3) horários públicos: antecedência, horizonte e grade
:as_anon
do $$
declare d date := test.day(3); r jsonb; ts timestamptz[];
begin
  r := public.ag_public_slots('salao-publico', test.t('s1'), test.t('profA'), d, d);
  select array_agg((t #>> '{}')::timestamptz) into ts from jsonb_array_elements(r -> 'days' -> 0 -> 'times') t;
  assert array_length(ts, 1) = 6 + 10 + 0 and ts[1] = test.at(d, '09:00'), 'serviço de 30 min: 09:00…11:30 e 13:00…17:30 = 16 horários';
  assert r ->> 'timezone' = 'America/Sao_Paulo', 'o fuso é informado';
  -- além do horizonte (30 dias): nada
  assert jsonb_array_length(public.ag_public_slots('salao-publico', test.t('s1'), test.t('profA'), test.day(40), test.day(42)) -> 'days') = 0, 'depois do horizonte não há horários';
  -- serviço interno, profissional inativo/sem vínculo: nada
  assert jsonb_array_length(public.ag_public_slots('salao-publico', test.t('s2'), test.t('profA'), d, d) -> 'days') = 0, 'serviço não público';
  assert jsonb_array_length(public.ag_public_slots('salao-publico', test.t('s1'), test.t('profX'), test.day(1), test.day(8)) -> 'days') = 0, 'profissional inativo';
  -- o passado nunca é oferecido
  assert jsonb_array_length(public.ag_public_slots('salao-publico', test.t('s1'), test.t('profA'), current_date - 5, current_date - 3) -> 'days') = 0, 'passado';
  -- janela máxima de consulta (31 dias)
  assert jsonb_array_length(public.ag_public_slots('salao-publico', test.t('s1'), test.t('profA'), test.day(1), test.day(30)) -> 'days') = 30, 'cobre o período pedido';
  raise notice 'PASS: horários públicos (4)';
end $$;
reset role;

-- antecedência mínima: com 14 dias de antecedência exigida, d+3 deixa de ser oferecido e reservar falha
:as_oc
do $$ begin perform public.ag_save_settings(test.t('org'), '{"minimum_notice_minutes":20160}'); end $$;
reset role;
:as_anon
do $$
declare d date := test.day(3);
begin
  assert jsonb_array_length(public.ag_public_slots('salao-publico', test.t('s1'), test.t('profA'), d, d) -> 'days') = 0, 'dentro da antecedência mínima: sem horários';
  perform test.has(test.errmsg(format($q$select public.ag_public_book('salao-publico', %L, %L, %L, 'Fulano Teste', '11 91234-5678', null, true, gen_random_uuid(), test.tok(), null)$q$, test.t('s1'), test.t('profA'), test.at(d, '10:00'))), '%mais antecedência%', 'reserva antes da antecedência mínima');
  raise notice 'PASS: antecedência mínima (5)';
end $$;
reset role;
:as_oc
do $$ begin perform public.ag_save_settings(test.t('org'), '{"minimum_notice_minutes":120}'); end $$;
reset role;

-- ===================================================================== (4) reservar: validações, idempotência e token só em hash
:as_anon
do $$
declare d date := test.day(3); sv uuid := test.t('s1'); pr uuid := test.t('profA'); tok text := test.tok(); idem uuid := gen_random_uuid(); r jsonb; r2 jsonb; txt text;
begin
  perform set_config('t.tok1', tok, true); perform set_config('t.idem1', idem::text, true);
  -- validações
  perform test.has(test.errmsg(format($q$select public.ag_public_book('salao-publico', %L, %L, %L, 'Fulano Teste', '11 91234-5678', null, false, gen_random_uuid(), test.tok(), null)$q$, sv, pr, test.at(d, '10:00'))), '%de acordo com o uso dos seus dados%', 'consentimento obrigatório');
  perform test.has(test.errmsg(format($q$select public.ag_public_book('salao-publico', %L, %L, %L, 'Fulano Teste', null, null, true, gen_random_uuid(), test.tok(), null)$q$, sv, pr, test.at(d, '10:00'))), '%telefone ou e-mail%', 'um contato é obrigatório');
  perform test.has(test.errmsg(format($q$select public.ag_public_book('salao-publico', %L, %L, %L, 'F', '11 91234-5678', null, true, gen_random_uuid(), test.tok(), null)$q$, sv, pr, test.at(d, '10:00'))), '%Nome deve ter%', 'nome curto');
  perform test.has(test.errmsg(format($q$select public.ag_public_book('salao-publico', %L, %L, %L, 'Fulano Teste', '123', null, true, gen_random_uuid(), test.tok(), null)$q$, sv, pr, test.at(d, '10:00'))), '%telefone inválido%', 'telefone inválido');
  perform test.has(test.errmsg(format($q$select public.ag_public_book('salao-publico', %L, %L, %L, 'Fulano Teste', null, 'sem-arroba', true, gen_random_uuid(), test.tok(), null)$q$, sv, pr, test.at(d, '10:00'))), '%e-mail inválido%', 'e-mail inválido');
  perform test.has(test.errmsg(format($q$select public.ag_public_book('salao-publico', %L, %L, %L, 'Fulano Teste', '11 91234-5678', null, true, gen_random_uuid(), 'curto', null)$q$, sv, pr, test.at(d, '10:00'))), '%solicitação inválida%', 'token curto demais');
  perform test.has(test.errmsg(format($q$select public.ag_public_book('salao-publico', %L, %L, %L, 'Fulano Teste', '11 91234-5678', null, true, gen_random_uuid(), test.tok(), null)$q$, sv, pr, test.at(d, '10:15'))), '%não está disponível%', 'fora da grade de horários (10:15)');
  perform test.has(test.errmsg(format($q$select public.ag_public_book('salao-publico', %L, %L, %L, 'Fulano Teste', '11 91234-5678', null, true, gen_random_uuid(), test.tok(), null)$q$, sv, pr, test.at(test.day(40), '10:00'))), '%além do período%', 'além do horizonte');
  perform test.has(test.errmsg(format($q$select public.ag_public_book('salao-publico', %L, %L, %L, 'Fulano Teste', '11 91234-5678', null, true, gen_random_uuid(), test.tok(), null)$q$, test.t('s2'), pr, test.at(d, '10:00'))), '%serviço não está disponível%', 'serviço não público');
  perform test.has(test.errmsg(format($q$select public.ag_public_book('salao-publico', %L, %L, %L, 'Fulano Teste', '11 91234-5678', null, true, gen_random_uuid(), test.tok(), null)$q$, sv, test.t('profX'), test.at(test.day(1), '10:00'))), '%não está disponível%', 'profissional inativo');
  assert test.cnt('select count(*) from public.appointments') = 0 and test.cnt('select count(*) from public.customers') = 0, 'nenhuma tentativa recusada deixou resíduo (cliente ou reserva)';
  -- reserva válida
  r := public.ag_public_book('salao-publico', sv, pr, test.at(d, '10:00'), 'Maria da Silva', '(11) 91234-5678', 'Maria@Exemplo.com', true, idem, tok, 'ip-hash-1');
  assert r ->> 'status' = 'scheduled' and (r ->> 'replayed')::boolean = false and r ->> 'service' = 'Corte' and r ->> 'professional' = 'Ana Cabeleireira', 'reserva criada';
  execute 'set constraints all immediate'; execute 'set constraints all deferred'; -- confere agora as travas que normalmente rodam no COMMIT, como o papel anon
  assert (r ->> 'starts_at')::timestamptz = test.at(d, '10:00'), 'horário correto';
  txt := r::text;
  assert txt !~* 'organization_id|customer|email|phone|maria|notes|token', 'a resposta não devolve dados pessoais nem o token';
  -- só o HASH do token existe no banco
  assert test.cnt(format('select count(*) from public.booking_management_tokens where token_hash = encode(sha256(convert_to(%L, ''UTF8'')), ''hex'')', tok)) = 1, 'hash do token guardado';
  assert test.cnt(format('select count(*) from public.booking_management_tokens where token_hash = %L', tok)) = 0, 'texto do token NÃO é guardado';
  assert test.cnt(format('select count(*) from public.appointment_events where safe_metadata::text like %L', '%' || tok || '%')) = 0, 'o token não vai para o histórico';
  assert test.txt('select source from public.appointments limit 1') = 'public', 'origem pública';
  assert test.cnt('select count(*) from public.appointment_events where event_type = ''created'' and safe_metadata @> ''{"consent":true}''') = 1, 'consentimento registrado no histórico';
  -- reenvio (duplo clique): mesma reserva, nenhuma duplicidade
  r2 := public.ag_public_book('salao-publico', sv, pr, test.at(d, '10:00'), 'Maria da Silva', '(11) 91234-5678', 'Maria@Exemplo.com', true, idem, tok, 'ip-hash-1');
  assert (r2 ->> 'replayed')::boolean = true and (r2 ->> 'starts_at') = (r ->> 'starts_at'), 'reenvio devolve a mesma reserva';
  assert test.cnt('select count(*) from public.appointments') = 1 and test.cnt('select count(*) from public.customers') = 1 and test.cnt('select count(*) from public.booking_management_tokens') = 1, 'sem duplicidade';
  perform test.has(test.errmsg(format($q$select public.ag_public_book('salao-publico', %L, %L, %L, 'Outra Pessoa', '(11) 90000-0000', null, true, %L, %L, null)$q$, sv, pr, test.at(d, '11:00'), idem, tok)), '%outros dados%', 'mesma chave com conteúdo diferente');
  -- o mesmo horário não pode ser reservado de novo (outro cliente, outra chave)
  perform test.has(test.errmsg(format($q$select public.ag_public_book('salao-publico', %L, %L, %L, 'Outra Pessoa', '(11) 90000-0000', null, true, gen_random_uuid(), test.tok(), null)$q$, sv, pr, test.at(d, '10:00'))), '%acabou de ser reservado%', 'horário já tomado');
  assert not exists (select 1 from jsonb_array_elements(public.ag_public_slots('salao-publico', sv, pr, d, d) -> 'days' -> 0 -> 'times') t where (t #>> '{}')::timestamptz = test.at(d, '10:00')), 'horário reservado some da página pública';
  raise notice 'PASS: reserva pública validada, idempotente e com token só em hash (6)';
end $$;
reset role;

-- ===================================================================== (5) link seguro: consultar, remarcar, cancelar
:as_anon
do $$
declare d date := test.day(3); tok text := current_setting('t.tok1'); r jsonb; sl jsonb; newt timestamptz;
begin
  r := public.ag_public_get_booking(tok);
  assert r ->> 'status' = 'scheduled' and (r ->> 'can_cancel')::boolean and (r ->> 'can_reschedule')::boolean and r ->> 'business' = 'Salão da Ana', 'consulta pelo link';
  assert (r::text) !~* 'organization_id|customer|email|phone|maria|notes|token', 'DTO do link sem dados pessoais';
  -- tokens inválidos respondem igual: nulo
  assert public.ag_public_get_booking(test.tok()) is null and public.ag_public_get_booking('curto') is null and public.ag_public_get_booking(null) is null and public.ag_public_get_booking(repeat('a', 200)) is null, 'token inválido não revela nada';
  assert public.ag_public_get_booking(upper(tok)) is null or upper(tok) = tok, 'token diferencia maiúsculas e minúsculas';
  -- remarcar: horários oferecidos mantêm serviço e profissional
  sl := public.ag_public_booking_slots(tok, d, d);
  assert jsonb_array_length(sl -> 'days') = 1, 'horários para remarcar';
  assert public.ag_public_booking_slots(test.tok(), d, d) is null, 'horários só com link válido';
  newt := test.at(d, '15:00');
  r := public.ag_public_reschedule(tok, newt);
  execute 'set constraints all immediate'; execute 'set constraints all deferred';
  assert (r ->> 'starts_at')::timestamptz = newt and r ->> 'service' = 'Corte', 'remarcada pelo cliente';
  assert test.cnt('select count(*) from public.appointment_events where event_type = ''rescheduled'' and actor_type = ''customer''') = 1, 'evento da remarcação pelo cliente';
  assert test.cnt('select count(*) from public.appointments') = 1, 'continua uma só reserva';
  -- remarcar para horário tomado preserva a reserva
  perform public.ag_public_book('salao-publico', test.t('s1'), test.t('profA'), test.at(d, '16:00'), 'Joana Souza', null, 'joana@exemplo.com', true, gen_random_uuid(), test.tok(), null);
  perform test.has(test.errmsg(format($q$select public.ag_public_reschedule(%L, %L)$q$, tok, test.at(d, '16:00'))), '%acabou de ser reservado%', 'remarcação conflitante');
  assert (public.ag_public_get_booking(tok) ->> 'starts_at')::timestamptz = newt, 'reserva original preservada';
  perform test.has(test.errmsg(format($q$select public.ag_public_reschedule(%L, %L)$q$, tok, test.at(d, '10:15'))), '%não está disponível%', 'remarcar para fora da grade');
  perform test.has(test.errmsg(format($q$select public.ag_public_reschedule(%L, now() - interval '1 day')$q$, tok)), '%já passou%', 'remarcar para o passado');
  perform test.has(test.errmsg(format($q$select public.ag_public_reschedule(%L, %L)$q$, test.tok(), newt)), '%link inválido%', 'remarcar com token inválido');
  raise notice 'PASS: consultar e remarcar pelo link (7)';
end $$;
reset role;

-- prazo de cancelamento/remarcação: com política de 30 dias, a reserva de d+3 já está fora do prazo
:as_oc
do $$ begin perform public.ag_save_settings(test.t('org'), '{"customer_cancellation_notice_minutes":43200,"customer_rescheduling_notice_minutes":43200}'); end $$;
reset role;
:as_anon
do $$
declare tok text := current_setting('t.tok1'); r jsonb;
begin
  r := public.ag_public_get_booking(tok);
  assert not (r ->> 'can_cancel')::boolean and not (r ->> 'can_reschedule')::boolean, 'fora do prazo: sem ações';
  perform test.has(test.errmsg(format($q$select public.ag_public_cancel(%L)$q$, tok)), '%prazo para cancelar%', 'cancelar fora do prazo');
  perform test.has(test.errmsg(format($q$select public.ag_public_reschedule(%L, now() + interval '5 days')$q$, tok)), '%prazo para remarcar%', 'remarcar fora do prazo');
  assert public.ag_public_get_booking(tok) ->> 'status' = 'scheduled', 'nada mudou';
  raise notice 'PASS: prazos da política respeitados (8)';
end $$;
reset role;
:as_oc
do $$ begin perform public.ag_save_settings(test.t('org'), '{"customer_cancellation_notice_minutes":1440,"customer_rescheduling_notice_minutes":1440}'); end $$;
reset role;

:as_anon
do $$
declare d date := test.day(3); tok text := current_setting('t.tok1'); r jsonb;
begin
  r := public.ag_public_cancel(tok);
  execute 'set constraints all immediate'; execute 'set constraints all deferred';
  assert r ->> 'status' = 'cancelled', 'cancelada pelo cliente';
  assert exists (select 1 from jsonb_array_elements(public.ag_public_slots('salao-publico', test.t('s1'), test.t('profA'), d, d) -> 'days' -> 0 -> 'times') t where (t #>> '{}')::timestamptz = test.at(d, '15:00')), 'horário liberado na página pública';
  assert public.ag_public_get_booking(tok) ->> 'status' = 'cancelled' and not (public.ag_public_get_booking(tok) ->> 'can_cancel')::boolean and not (public.ag_public_get_booking(tok) ->> 'can_reschedule')::boolean, 'o link continua mostrando a reserva como cancelada, sem ações';
  perform test.has(test.errmsg(format($q$select public.ag_public_cancel(%L)$q$, tok)), '%não pode mais ser cancelada%', 'cancelar duas vezes');
  perform test.has(test.errmsg(format($q$select public.ag_public_reschedule(%L, now() + interval '5 days')$q$, tok)), '%não pode mais ser remarcada%', 'remarcar uma reserva cancelada');
  assert test.cnt('select count(*) from public.appointment_events where event_type = ''cancelled'' and actor_type = ''customer''') = 1, 'evento do cancelamento';
  assert test.txt('select cancellation_reason from public.appointments where status = ''cancelled''') = 'Cancelado pelo cliente', 'motivo registrado';
  raise notice 'PASS: cancelamento pelo link libera o horário e o link passa a mostrar «cancelada» (9)';
end $$;
reset role;

-- ===================================================================== (6) token expirado, revogado e reemitido pela equipe
:as_mc
do $$
declare org uuid := test.t('org'); a uuid; tok2 text := test.tok(); r jsonb; newtok text;
begin
  select id into a from public.appointments where status = 'scheduled' limit 1;
  perform set_config('t.apptJ', a::text, true);
  -- a equipe emite um link novo (o texto só existe nesta resposta)
  r := public.ag_reissue_link(org, a);
  newtok := r ->> 'token';
  assert length(newtok) = 64 and newtok ~ '^[0-9a-f]{64}$', 'token de 256 bits (hex)';
  perform set_config('t.tokJ', newtok, true);
  assert public.ag_reissue_link(org, a) ->> 'token' <> newtok, 'cada emissão gera um token novo';
  perform test.has(test.errmsg(format($q$select public.ag_reissue_link(%L, %L)$q$, org, test.t('profA'))), '%não encontrado%', 'id de outro tipo não emite link');
end $$;
reset role;
:as_anon
do $$
declare tok text := current_setting('t.tokJ');
begin
  assert public.ag_public_get_booking(tok) is null, 'o link anterior foi revogado ao emitir outro';
end $$;
reset role;
:as_mc
do $$
declare org uuid := test.t('org'); r jsonb;
begin
  r := public.ag_reissue_link(org, test.t('apptJ'));
  perform set_config('t.tokK', r ->> 'token', true);
end $$;
reset role;
do $$
begin
  -- expirado
  perform test.sql(format('update public.booking_management_tokens set expires_at = now() - interval ''1 minute'' where token_hash = encode(sha256(convert_to(%L, ''UTF8'')), ''hex'')', current_setting('t.tokK')));
end $$;
:as_anon
do $$
begin
  assert public.ag_public_get_booking(current_setting('t.tokK')) is null, 'token expirado';
  perform test.has(test.errmsg(format($q$select public.ag_public_cancel(%L)$q$, current_setting('t.tokK'))), '%link inválido%', 'cancelar com token expirado');
  raise notice 'PASS: token expirado e revogado são rejeitados (10)';
end $$;
reset role;

-- ===================================================================== (7) limite de abuso por contato
:as_anon
do $$
declare k integer; ok integer := 0; msg text; d date;
begin
  for k in 1 .. 8 loop
    d := test.day(3 + k);
    msg := test.errmsg(format($q$select public.ag_public_book('salao-publico', %L, %L, %L, 'Pessoa Insistente', '(21) 98888-7777', null, true, gen_random_uuid(), test.tok(), null)$q$, test.t('s1'), test.t('profA'), test.at(d, '10:00')));
    if msg is null then ok := ok + 1; else perform test.has(msg, '%Muitas tentativas%', 'o bloqueio é por excesso de tentativas'); exit; end if;
  end loop;
  assert ok = 6, 'o mesmo contato faz até 6 reservas por hora (fez ' || ok || ')';
  raise notice 'PASS: limite por contato (11)';
end $$;
reset role;

-- ===================================================================== (8) superfície do papel anon
:as_anon
do $$
begin
  perform test.has(test.errmsg('select count(*) from public.appointments'), '%permission denied%', 'anon não lê agendamentos');
  perform test.has(test.errmsg('select count(*) from public.customers'), '%permission denied%', 'anon não lê clientes');
  perform test.has(test.errmsg('select count(*) from public.booking_management_tokens'), '%permission denied%', 'anon não lê tokens');
  perform test.has(test.errmsg('select count(*) from public.scheduling_settings'), '%permission denied%', 'anon não lê configurações');
  perform test.has(test.errmsg('insert into public.customers (organization_id, name) values (gen_random_uuid(), ''x'')'), '%permission denied%', 'anon não escreve');
  perform test.has(test.errmsg(format($q$select public.ag_slots(%L, %L, %L, current_date, current_date)$q$, test.t('org'), test.t('profA'), test.t('s1'))), '%permission denied%', 'anon não chama funções administrativas');
  perform test.has(test.errmsg(format($q$select public.ag_set_status(%L, gen_random_uuid(), 'cancel', null)$q$, test.t('org'))), '%permission denied%', 'anon não altera status');
  perform test.has(test.errmsg('select private.ag_profile(gen_random_uuid())'), '%permission denied%', 'anon não chama funções internas');
  raise notice 'PASS: anon só alcança as operações públicas (12)';
end $$;
reset role;

-- ===================================================================== (9) LGPD: anonimizar cliente revoga links e limpa dados
:as_oc
do $$
declare org uuid := test.t('org'); c uuid;
begin
  select customer_id into c from public.appointments where status = 'scheduled' order by created_at limit 1;
  perform public.ag_anonymize_customer(org, c);
  assert (select name from public.customers where id = c) = 'Cliente anonimizado' and (select email from public.customers where id = c) is null and (select phone from public.customers where id = c) is null, 'dados pessoais removidos';
  assert test.cnt(format('select count(*) from public.booking_management_tokens t join public.appointments a on a.id = t.appointment_id where a.customer_id = %L and t.revoked_at is null', c)) = 0, 'links do cliente revogados';
  perform test.has(test.errmsg(format($q$select public.ag_anonymize_customer(%L, %L)$q$, org, c)), '%já anonimizado%', 'anonimizar duas vezes');
  assert (select count(*) from public.appointments where customer_id = c) >= 1, 'o histórico estatístico permanece';
  raise notice 'PASS: anonimização de cliente (LGPD) (13)';
end $$;
reset role;

rollback;
