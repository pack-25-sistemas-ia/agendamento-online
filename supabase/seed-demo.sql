-- DEMONSTRAÇÃO «Estúdio Aurora» — dados 100% fictícios, determinísticos e RELATIVOS à data de execução (hoje −14 … hoje +10 dias).
-- Aplicado por `node scripts/seed-demo.mjs` (senha aleatória gerada na hora e exibida só no seu terminal; nenhuma credencial fixa é publicada).
-- Somente para uso LOCAL. NUNCA aplique em produção. Variável psql: pw (senha dos usuários @demo.exemplo).
-- Usuários: dono, recepcao, ana, carlos, diana @demo.exemplo. O proprietário cadastra o 2º fator (TOTP) no primeiro acesso.

select set_config('demo.pw', :'pw', false);
select set_config('request.jwt.claims', '', false);
begin;

do $$
declare pw text := extensions.crypt(current_setting('demo.pw'), extensions.gen_salt('bf'));
begin
  if exists (select 1 from public.organizations where slug = 'estudio-aurora') then raise exception 'a demonstração já existe neste banco (rode supabase db reset antes)'; end if;
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', e.email, pw, now(), '{"provider":"email","providers":["email"]}'::jsonb,
         jsonb_build_object('full_name', e.nome), now(), now(), '', '', '', ''
  from (values ('dono@demo.exemplo', 'Helena Aurora'), ('recepcao@demo.exemplo', 'Rita Recepção'), ('ana@demo.exemplo', 'Ana Beatriz'), ('carlos@demo.exemplo', 'Carlos Eduardo'), ('diana@demo.exemplo', 'Diana Lopes')) e(email, nome);
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  select gen_random_uuid(), u.id, u.email, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true), 'email', now(), now(), now() from auth.users u where u.email like '%@demo.exemplo';
  update public.profiles p set full_name = u.raw_user_meta_data ->> 'full_name' from auth.users u where u.id = p.id and u.email like '%@demo.exemplo';
end $$;

-- empresa e papéis (a partir daqui o proprietário «assina» como AAL2, como faria no app depois de cadastrar o 2º fator)
select set_config('request.jwt.claims', json_build_object('sub', (select id::text from auth.users where email = 'dono@demo.exemplo'), 'aal', 'aal2', 'role', 'authenticated')::text, false);
select public.create_organization('Estúdio Aurora (demonstração)', 'estudio-aurora') as org \gset
insert into public.organization_members (organization_id, user_id, role)
select :'org', u.id, case u.email when 'recepcao@demo.exemplo' then 'manager'::public.org_role else 'member'::public.org_role end from auth.users u
where u.email in ('recepcao@demo.exemplo', 'ana@demo.exemplo', 'carlos@demo.exemplo', 'diana@demo.exemplo');

select public.ag_save_settings(:'org', jsonb_build_object(
  'public_booking_enabled', true, 'public_display_name', 'Estúdio Aurora — demonstração', 'primary_color', '#0f766e',
  'public_description', 'AMBIENTE DE DEMONSTRAÇÃO com dados fictícios: nenhuma reserva aqui é real. Cabelo, barba e coloração com hora marcada.',
  'public_contact', '(11) 4000-0000 · contato@demo.exemplo', 'minimum_notice_minutes', 120, 'booking_horizon_days', 45, 'slot_step_minutes', 30,
  'customer_cancellation_notice_minutes', 1440, 'customer_rescheduling_notice_minutes', 1440,
  'booking_policy_text', 'Cancelamentos e remarcações pelo link até 24 horas antes. Depois desse prazo, fale com a recepção. Atrasos acima de 15 minutos podem exigir remarcação.'));

-- serviços
select public.ag_save_service(:'org', null, 'Corte feminino', 'Lavagem, corte e finalização', 60, 10, 10, 12000, true, true) as s_corte_f \gset
select public.ag_save_service(:'org', null, 'Corte masculino', 'Corte na máquina ou tesoura', 30, 0, 5, 6000, true, true) as s_corte_m \gset
select public.ag_save_service(:'org', null, 'Barba', 'Barba completa com toalha quente', 30, 0, 5, 4500, true, true) as s_barba \gset
select public.ag_save_service(:'org', null, 'Coloração', 'Coloração completa (preço varia com o comprimento)', 120, 10, 15, 25000, true, true) as s_cor \gset
select public.ag_save_service(:'org', null, 'Escova', 'Escova modeladora', 45, 0, 0, 7000, true, true) as s_escova \gset

-- profissionais (vinculados aos usuários, para o perfil «Profissional»)
select public.ag_save_professional(:'org', null, 'Ana Beatriz', 'Cabeleireira há 12 anos, especialista em cortes femininos e coloração.', '#be185d', true, (select id from auth.users where email = 'ana@demo.exemplo')) as p_ana \gset
select public.ag_save_professional(:'org', null, 'Carlos Eduardo', 'Barbeiro e cabeleireiro masculino.', '#2563eb', true, (select id from auth.users where email = 'carlos@demo.exemplo')) as p_carlos \gset
select public.ag_save_professional(:'org', null, 'Diana Lopes', 'Colorista e escovista.', '#9333ea', true, (select id from auth.users where email = 'diana@demo.exemplo')) as p_diana \gset
select public.ag_set_professional_services(:'org', :'p_ana', array[:'s_corte_f', :'s_corte_m', :'s_cor', :'s_escova']::uuid[]);
select public.ag_set_professional_services(:'org', :'p_carlos', array[:'s_corte_m', :'s_barba', :'s_escova']::uuid[]);
select public.ag_set_professional_services(:'org', :'p_diana', array[:'s_corte_f', :'s_cor', :'s_escova']::uuid[]);

-- disponibilidade (almoço fora das janelas): Ana seg–sáb 09–12 e 13–18 · Carlos ter–sáb 10–14 e 15–19 · Diana seg–sex 08–12 e 13–17
select public.ag_save_weekly(:'org', :'p_ana', (select jsonb_agg(x) from (
  select jsonb_build_object('weekday', d, 'start', '09:00', 'end', '12:00') x from generate_series(1, 6) d union all select jsonb_build_object('weekday', d, 'start', '13:00', 'end', '18:00') from generate_series(1, 6) d) q));
select public.ag_save_weekly(:'org', :'p_carlos', (select jsonb_agg(x) from (
  select jsonb_build_object('weekday', d, 'start', '10:00', 'end', '14:00') x from generate_series(2, 6) d union all select jsonb_build_object('weekday', d, 'start', '15:00', 'end', '19:00') from generate_series(2, 6) d) q));
select public.ag_save_weekly(:'org', :'p_diana', (select jsonb_agg(x) from (
  select jsonb_build_object('weekday', d, 'start', '08:00', 'end', '12:00') x from generate_series(1, 5) d union all select jsonb_build_object('weekday', d, 'start', '13:00', 'end', '17:00') from generate_series(1, 5) d) q));

-- exceção por data (Diana folga num dia útil, daqui a 8 dias) e bloqueios (curso do Carlos; Ana sai mais cedo daqui a 3 dias)
select public.ag_save_override_day(:'org', :'p_diana', private.ag_today(:'org') + 8, true, null);
select public.ag_create_block(:'org', :'p_carlos', ((private.ag_today(:'org') + 5 + time '15:00') at time zone 'America/Sao_Paulo'), ((private.ag_today(:'org') + 5 + time '19:00') at time zone 'America/Sao_Paulo'), 'Curso de aperfeiçoamento');
select public.ag_create_block(:'org', :'p_ana', ((private.ag_today(:'org') + 3 + time '16:30') at time zone 'America/Sao_Paulo'), ((private.ag_today(:'org') + 3 + time '18:00') at time zone 'America/Sao_Paulo'), 'Consulta médica');

-- clientes fictícios
insert into public.customers (organization_id, name, email, phone)
select :'org', c.nome, lower(replace(c.nome, ' ', '.')) || '@demo.exemplo', '(11) 9' || lpad((90000 + c.n)::text, 5, '0') || '-' || lpad((1000 + c.n)::text, 4, '0')
from (values (1, 'Marina Duarte'), (2, 'Lucas Ferraz'), (3, 'Patrícia Nogueira'), (4, 'Rodrigo Campos'), (5, 'Fernanda Teixeira'), (6, 'Gustavo Almeida'), (7, 'Beatriz Moreira'),
  (8, 'Thiago Barros'), (9, 'Camila Rezende'), (10, 'Eduardo Pires'), (11, 'Larissa Cunha'), (12, 'Henrique Salles'), (13, 'Vanessa Moura'), (14, 'Otávio Brandão')) c(n, nome);

-- agenda: compromissos coerentes (dentro das janelas, sem conflitos, com status condizentes com a data)
do $$
declare
  org uuid := (select id from public.organizations where slug = 'estudio-aurora'); tz text := 'America/Sao_Paulo'; today date;
  p record; d integer; w record; s public.services; cur timestamptz; seq integer := 0; k integer; len integer; ent uuid; ap uuid; st text; src text; cust uuid[]; h integer; os timestamptz; oe timestamptz; startat timestamptz; nsv integer; pend boolean;
begin
  today := private.ag_today(org);
  select array_agg(id order by name) into cust from public.customers where organization_id = org;
  for p in select id, name, linked_user_id from public.professionals where organization_id = org order by name loop
    select count(*) into nsv from public.professional_services where professional_id = p.id;
    pend := false;
    for d in -14 .. 10 loop
      k := 0;
      for w in select * from private.ag_windows(p.id, today + d, tz) order by w_start loop
        cur := w.w_start;
        loop
          seq := seq + 1;
          h := abs(hashtext(p.id::text || ':' || d || ':' || seq));
          select sv.* into s from public.services sv join public.professional_services ps on ps.service_id = sv.id where ps.professional_id = p.id order by sv.name offset (h % nsv) limit 1;
          len := s.buffer_before_minutes + s.duration_minutes + s.buffer_after_minutes;
          exit when cur + make_interval(mins => len) > w.w_end;
          os := cur; oe := cur + make_interval(mins => len); startat := cur + make_interval(mins => s.buffer_before_minutes);
          if h % 100 < 60 and k < 4 and not exists (select 1 from public.schedule_entries e where e.professional_id = p.id and e.active and tstzrange(e.occupied_start_at, e.occupied_end_at, '[)') && tstzrange(os, oe, '[)')) then
            k := k + 1;
            st := case when startat + make_interval(mins => s.duration_minutes) < now()
                       then case when (h / 100) % 100 < 80 then 'completed' when (h / 100) % 100 < 90 then 'no_show' else 'cancelled' end
                       else case when (h / 100) % 100 < 35 then 'scheduled' when (h / 100) % 100 < 92 then 'confirmed' else 'cancelled' end end;
            -- no futuro: a maioria pendente/confirmada; poucos cancelados
            if startat >= now() and st = 'cancelled' and h % 7 <> 0 then st := 'confirmed'; end if;
            -- operação real: o primeiro atendimento dos últimos dias de cada profissional ainda está «confirmado» (falta registrar a conclusão)
            if d between -4 and -1 and not pend and st <> 'cancelled' and startat + make_interval(mins => s.duration_minutes) < now() then st := 'confirmed'; pend := true; end if;
            src := case when h % 9 < 4 then 'public' else 'admin' end;
            insert into public.schedule_entries (organization_id, professional_id, kind, occupied_start_at, occupied_end_at, active) values (org, p.id, 'appointment', os, oe, st <> 'cancelled') returning id into ent;
            insert into public.appointments (organization_id, schedule_entry_id, professional_id, customer_id, service_id, starts_at, ends_at, status, source, service_name_snapshot, duration_minutes_snapshot,
              buffer_before_minutes_snapshot, buffer_after_minutes_snapshot, reference_price_cents_snapshot, internal_notes, cancellation_reason)
            values (org, ent, p.id, cust[1 + (h / 7) % array_length(cust, 1)], s.id, startat, startat + make_interval(mins => s.duration_minutes), st, src, s.name, s.duration_minutes,
              s.buffer_before_minutes, s.buffer_after_minutes, s.reference_price_cents, case when h % 11 = 0 then 'Cliente prefere atendimento sem conversa.' end, case when st = 'cancelled' then 'Cliente avisou que não poderá comparecer.' end)
            returning id into ap;
            insert into public.appointment_events (organization_id, appointment_id, event_type, actor_type, safe_metadata) values (org, ap, 'created', case when src = 'public' then 'customer' else 'admin' end, jsonb_build_object('source', src));
            if st in ('confirmed', 'completed', 'no_show') then insert into public.appointment_events (organization_id, appointment_id, event_type, actor_type) values (org, ap, 'confirmed', 'admin'); end if;
            if st = 'completed' then insert into public.appointment_events (organization_id, appointment_id, event_type, actor_type) values (org, ap, 'completed', 'professional');
            elsif st = 'no_show' then insert into public.appointment_events (organization_id, appointment_id, event_type, actor_type) values (org, ap, 'no_show', 'professional');
            elsif st = 'cancelled' then insert into public.appointment_events (organization_id, appointment_id, event_type, actor_type) values (org, ap, 'cancelled', 'admin'); end if;
          end if;
          cur := cur + make_interval(mins => len + 15 * (1 + h % 4));
        end loop;
      end loop;
    end loop;
  end loop;
end $$;

commit;
select set_config('request.jwt.claims', '', false);
