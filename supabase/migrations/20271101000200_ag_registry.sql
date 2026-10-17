-- Agendamento Online — CADASTROS E CONFIGURAÇÃO: profissionais, serviços, clientes, disponibilidade, bloqueios e políticas.
-- Toda função: sessão + MFA + perfil (private.ag_guard), valida entrada e grava; a interface nunca escreve direto nas tabelas.

begin;
set local check_function_bodies = off;

-- ======================================================================= utilidades de validação
create function private.ag_req_text(p text, p_min integer, p_max integer, p_label text) returns text
language plpgsql immutable set search_path = '' as $$
declare t text := btrim(coalesce(p, ''));
begin
  if char_length(t) < p_min or char_length(t) > p_max then
    raise exception '% deve ter entre % e % caracteres', p_label, p_min, p_max using errcode = '22023';
  end if;
  return t;
end $$;
create function private.ag_opt_text(p text, p_max integer, p_label text) returns text
language plpgsql immutable set search_path = '' as $$
declare t text := nullif(btrim(coalesce(p, '')), '');
begin
  if t is not null and char_length(t) > p_max then raise exception '% deve ter no máximo % caracteres', p_label, p_max using errcode = '22023'; end if;
  return t;
end $$;
-- «HH:MM» → time (aceita 24:00 como fim do dia)
create function private.ag_parse_time(p text, p_label text) returns time
language plpgsql immutable set search_path = '' as $$
begin
  if p is null or p !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$|^24:00$' then raise exception '% inválido (use HH:MM)', p_label using errcode = '22023'; end if;
  return p::time;
end $$;
create function private.ag_color(p text, p_label text) returns text
language plpgsql immutable set search_path = '' as $$
begin
  if p is null or p !~ '^#[0-9a-fA-F]{6}$' then raise exception '% inválida (use #RRGGBB)', p_label using errcode = '22023'; end if;
  return lower(p);
end $$;
revoke all on function private.ag_req_text(text, integer, integer, text), private.ag_opt_text(text, integer, text), private.ag_parse_time(text, text), private.ag_color(text, text) from public, anon, authenticated;

-- ======================================================================= contexto do usuário na empresa
create function public.ag_my_context(p_org uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('profile', private.ag_profile(p_org), 'professional_id', private.ag_my_professional(p_org),
    'timezone', private.ag_tz(p_org), 'today', private.ag_today(p_org));
$$;

-- ======================================================================= profissionais
create function public.ag_save_professional(p_org uuid, p_id uuid, p_name text, p_bio text, p_color text, p_active boolean, p_user uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := p_id; cur uuid;
begin
  perform private.ag_guard(p_org, 'manager');
  if v_id is not null then
    select linked_user_id into cur from public.professionals where id = v_id and organization_id = p_org;
    if not found then raise exception 'profissional não encontrado' using errcode = 'P0002'; end if;
  end if;
  -- vincular um usuário concede acesso à agenda dele: só o proprietário decide
  if p_user is distinct from cur then
    if not private.ag_is_owner(p_org) then raise exception 'somente o proprietário vincula um usuário a um profissional' using errcode = '42501'; end if;
    if p_user is not null and not exists (select 1 from public.organization_members m where m.organization_id = p_org and m.user_id = p_user and m.role = 'member') then
      raise exception 'o usuário vinculado deve ser membro da empresa com papel «Membro»' using errcode = '22023';
    end if;
  end if;
  if v_id is null then
    insert into public.professionals (organization_id, name, public_bio, display_color, active, linked_user_id)
    values (p_org, private.ag_req_text(p_name, 2, 80, 'Nome'), private.ag_opt_text(p_bio, 300, 'Apresentação'), private.ag_color(coalesce(p_color, '#2563eb'), 'Cor'), coalesce(p_active, true), p_user) returning id into v_id;
  else
    update public.professionals p set name = private.ag_req_text(p_name, 2, 80, 'Nome'), public_bio = private.ag_opt_text(p_bio, 300, 'Apresentação'),
      display_color = private.ag_color(coalesce(p_color, p.display_color), 'Cor'), active = coalesce(p_active, p.active), linked_user_id = p_user
    where p.id = v_id and p.organization_id = p_org;
  end if;
  return v_id;
exception when unique_violation then
  raise exception 'este usuário já está vinculado a outro profissional' using errcode = '23505';
end $$;

create function public.ag_set_professional_services(p_org uuid, p_prof uuid, p_services uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  perform private.ag_guard(p_org, 'manager');
  if not exists (select 1 from public.professionals where id = p_prof and organization_id = p_org) then raise exception 'profissional não encontrado' using errcode = 'P0002'; end if;
  p_services := coalesce(p_services, '{}');
  if cardinality(p_services) > 100 then raise exception 'serviços demais' using errcode = '22023'; end if;
  select count(*) into n from public.services where organization_id = p_org and id = any (p_services);
  if n <> (select count(distinct x) from unnest(p_services) x) then raise exception 'serviço não encontrado' using errcode = 'P0002'; end if;
  perform private.ag_lock(p_prof);
  delete from public.professional_services where professional_id = p_prof and organization_id = p_org and not (service_id = any (p_services));
  insert into public.professional_services (organization_id, professional_id, service_id) select p_org, p_prof, x from unnest(p_services) x on conflict do nothing;
end $$;

-- ======================================================================= serviços (duração e intervalos valem para NOVAS reservas; as existentes guardam um retrato)
create function public.ag_save_service(p_org uuid, p_id uuid, p_name text, p_description text, p_duration integer, p_buf_before integer, p_buf_after integer,
  p_price_cents bigint, p_active boolean, p_public boolean) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := p_id;
begin
  perform private.ag_guard(p_org, 'manager');
  if p_duration is null or p_duration not between 5 and 720 then raise exception 'a duração deve ficar entre 5 e 720 minutos' using errcode = '22023'; end if;
  if coalesce(p_buf_before, 0) not between 0 and 240 or coalesce(p_buf_after, 0) not between 0 and 240 then raise exception 'os intervalos devem ficar entre 0 e 240 minutos' using errcode = '22023'; end if;
  if p_price_cents is not null and p_price_cents not between 0 and 100000000 then raise exception 'preço de referência inválido' using errcode = '22023'; end if;
  if v_id is null then
    insert into public.services (organization_id, name, description, duration_minutes, buffer_before_minutes, buffer_after_minutes, reference_price_cents, active, public_booking_enabled)
    values (p_org, private.ag_req_text(p_name, 2, 80, 'Nome'), private.ag_opt_text(p_description, 400, 'Descrição'), p_duration, coalesce(p_buf_before, 0), coalesce(p_buf_after, 0), p_price_cents, coalesce(p_active, true), coalesce(p_public, true))
    returning id into v_id;
  else
    update public.services s set name = private.ag_req_text(p_name, 2, 80, 'Nome'), description = private.ag_opt_text(p_description, 400, 'Descrição'), duration_minutes = p_duration,
      buffer_before_minutes = coalesce(p_buf_before, 0), buffer_after_minutes = coalesce(p_buf_after, 0), reference_price_cents = p_price_cents,
      active = coalesce(p_active, s.active), public_booking_enabled = coalesce(p_public, s.public_booking_enabled)
    where s.id = v_id and s.organization_id = p_org;
    if not found then raise exception 'serviço não encontrado' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end $$;

-- ======================================================================= clientes (nunca mescla por nome ou contato: um telefone pode ser compartilhado)
create function public.ag_save_customer(p_org uuid, p_id uuid, p_name text, p_email text, p_phone text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := p_id; em text := nullif(lower(btrim(coalesce(p_email, ''))), ''); ph text := nullif(btrim(coalesce(p_phone, '')), '');
begin
  perform private.ag_guard(p_org, 'manager');
  if em is not null and (char_length(em) > 200 or em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then raise exception 'e-mail inválido' using errcode = '22023'; end if;
  if ph is not null and (ph !~ '^[0-9+()\s.-]{8,30}$' or char_length(regexp_replace(ph, '\D', '', 'g')) not between 8 and 15) then raise exception 'telefone inválido (use DDD e número)' using errcode = '22023'; end if;
  if v_id is null then
    insert into public.customers (organization_id, name, email, phone) values (p_org, private.ag_req_text(p_name, 2, 120, 'Nome'), em, ph) returning id into v_id;
  else
    update public.customers c set name = private.ag_req_text(p_name, 2, 120, 'Nome'), email = em, phone = ph where c.id = v_id and c.organization_id = p_org and c.anonymized_at is null;
    if not found then raise exception 'cliente não encontrado' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end $$;

-- LGPD: anonimiza o cliente (nome, e-mail e telefone) e limpa as notas internas dos atendimentos; o histórico estatístico permanece.
create function public.ag_anonymize_customer(p_org uuid, p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare a record;
begin
  perform private.ag_guard(p_org, 'owner');
  update public.customers set name = 'Cliente anonimizado', email = null, phone = null, anonymized_at = now() where id = p_id and organization_id = p_org and anonymized_at is null;
  if not found then raise exception 'cliente não encontrado ou já anonimizado' using errcode = 'P0002'; end if;
  for a in select id from public.appointments where customer_id = p_id and organization_id = p_org loop
    update public.appointments set internal_notes = null where id = a.id;
    insert into public.appointment_events (organization_id, appointment_id, event_type, actor_type, actor_user_id) values (p_org, a.id, 'customer_anonymized', 'admin', (select auth.uid()));
  end loop;
  update public.booking_management_tokens set revoked_at = now() where organization_id = p_org and revoked_at is null
    and appointment_id in (select id from public.appointments where customer_id = p_id and organization_id = p_org);
  perform private.ag_audit(p_org, 'anonymize', 'customers', p_id);
end $$;

-- ======================================================================= disponibilidade semanal (substitui o conjunto inteiro do profissional)
create function public.ag_save_weekly(p_org uuid, p_prof uuid, p_rules jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare r jsonb;
begin
  perform private.ag_guard(p_org, 'manager');
  if not exists (select 1 from public.professionals where id = p_prof and organization_id = p_org) then raise exception 'profissional não encontrado' using errcode = 'P0002'; end if;
  if jsonb_typeof(p_rules) <> 'array' or jsonb_array_length(p_rules) > 56 then raise exception 'informe até 56 intervalos' using errcode = '22023'; end if;
  perform private.ag_lock(p_prof);
  delete from public.availability_rules where professional_id = p_prof and organization_id = p_org;
  for r in select value from jsonb_array_elements(p_rules) loop
    if jsonb_typeof(r) <> 'object' or (r ->> 'weekday') is null or (r ->> 'weekday') !~ '^[0-6]$' then raise exception 'dia da semana inválido' using errcode = '22023'; end if;
    if private.ag_parse_time(r ->> 'start', 'Início') >= private.ag_parse_time(r ->> 'end', 'Fim') then raise exception 'o fim deve ser depois do início' using errcode = '22023'; end if;
    insert into public.availability_rules (organization_id, professional_id, weekday, local_start_time, local_end_time)
    values (p_org, p_prof, (r ->> 'weekday')::smallint, private.ag_parse_time(r ->> 'start', 'Início'), private.ag_parse_time(r ->> 'end', 'Fim'));
  end loop;
  perform private.ag_audit(p_org, 'update', 'availability_rules', p_prof, jsonb_build_object('intervals', jsonb_array_length(p_rules)));
exception when exclusion_violation then
  raise exception 'há intervalos sobrepostos no mesmo dia da semana' using errcode = '22023';
end $$;

-- Exceção por data: intervalos próprios OU dia fechado. Substitui o dia inteiro (a regra semanal não vale nessa data).
create function public.ag_save_override_day(p_org uuid, p_prof uuid, p_date date, p_closed boolean, p_intervals jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare r jsonb;
begin
  perform private.ag_guard(p_org, 'manager');
  if not exists (select 1 from public.professionals where id = p_prof and organization_id = p_org) then raise exception 'profissional não encontrado' using errcode = 'P0002'; end if;
  if p_date is null or p_date < private.ag_today(p_org) - 1 or p_date > private.ag_today(p_org) + 730 then raise exception 'data fora do período permitido' using errcode = '22023'; end if;
  if not coalesce(p_closed, false) and (jsonb_typeof(p_intervals) <> 'array' or jsonb_array_length(p_intervals) not between 1 and 8) then
    raise exception 'informe de 1 a 8 intervalos ou marque o dia como fechado' using errcode = '22023';
  end if;
  perform private.ag_lock(p_prof);
  delete from public.availability_overrides where professional_id = p_prof and organization_id = p_org and local_date = p_date;
  if coalesce(p_closed, false) then
    insert into public.availability_overrides (organization_id, professional_id, local_date) values (p_org, p_prof, p_date);
  else
    for r in select value from jsonb_array_elements(p_intervals) loop
      if private.ag_parse_time(r ->> 'start', 'Início') >= private.ag_parse_time(r ->> 'end', 'Fim') then raise exception 'o fim deve ser depois do início' using errcode = '22023'; end if;
      insert into public.availability_overrides (organization_id, professional_id, local_date, local_start_time, local_end_time)
      values (p_org, p_prof, p_date, private.ag_parse_time(r ->> 'start', 'Início'), private.ag_parse_time(r ->> 'end', 'Fim'));
    end loop;
  end if;
exception when exclusion_violation then
  raise exception 'há intervalos sobrepostos nesta data' using errcode = '22023';
end $$;

create function public.ag_delete_override_day(p_org uuid, p_prof uuid, p_date date) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.ag_guard(p_org, 'manager');
  perform private.ag_lock(p_prof);
  delete from public.availability_overrides where professional_id = p_prof and organization_id = p_org and local_date = p_date;
end $$;

-- ======================================================================= bloqueios (disputam o mesmo espaço da agenda que as reservas)
create function public.ag_create_block(p_org uuid, p_prof uuid, p_start timestamptz, p_end timestamptz, p_reason text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform private.ag_guard(p_org, 'manager');
  if not exists (select 1 from public.professionals where id = p_prof and organization_id = p_org) then raise exception 'profissional não encontrado' using errcode = 'P0002'; end if;
  if p_start is null or p_end is null or p_end <= p_start then raise exception 'o fim do bloqueio deve ser depois do início' using errcode = '22023'; end if;
  if p_end <= now() then raise exception 'o bloqueio deve terminar no futuro' using errcode = '22023'; end if;
  if p_end - p_start > interval '31 days' then raise exception 'um bloqueio pode durar no máximo 31 dias' using errcode = '22023'; end if;
  perform private.ag_lock(p_prof);
  begin
    insert into public.schedule_entries (organization_id, professional_id, kind, occupied_start_at, occupied_end_at, block_reason, created_by)
    values (p_org, p_prof, 'block', p_start, p_end, private.ag_opt_text(p_reason, 200, 'Motivo'), (select auth.uid())) returning id into v_id;
  exception when exclusion_violation then
    raise exception 'já existe um atendimento ou bloqueio neste período' using errcode = '23P01';
  end;
  perform private.ag_audit(p_org, 'insert', 'schedule_entries', v_id, jsonb_build_object('kind', 'block'));
  return v_id;
end $$;

create function public.ag_cancel_block(p_org uuid, p_entry uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.ag_guard(p_org, 'manager');
  update public.schedule_entries set active = false where id = p_entry and organization_id = p_org and kind = 'block' and active;
  if not found then raise exception 'bloqueio não encontrado' using errcode = 'P0002'; end if;
  perform private.ag_audit(p_org, 'update', 'schedule_entries', p_entry, jsonb_build_object('columns', jsonb_build_array('active')));
end $$;

-- ======================================================================= políticas e identidade da página pública
create function public.ag_save_settings(p_org uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.scheduling_settings;
begin
  perform private.ag_guard(p_org, 'owner');
  if jsonb_typeof(p) <> 'object' then raise exception 'dados inválidos' using errcode = '22023'; end if;
  select * into s from public.scheduling_settings where organization_id = p_org for update;
  if p ? 'timezone' then
    if not exists (select 1 from pg_catalog.pg_timezone_names n where n.name = p ->> 'timezone') then raise exception 'fuso horário inválido' using errcode = '22023'; end if;
    s.timezone := p ->> 'timezone';
  end if;
  if p ? 'public_booking_enabled' then s.public_booking_enabled := (p ->> 'public_booking_enabled')::boolean; end if;
  if p ? 'public_display_name' then s.public_display_name := private.ag_opt_text(p ->> 'public_display_name', 80, 'Nome público'); end if;
  if p ? 'primary_color' then s.primary_color := private.ag_color(p ->> 'primary_color', 'Cor principal'); end if;
  if p ? 'public_description' then s.public_description := private.ag_opt_text(p ->> 'public_description', 500, 'Descrição'); end if;
  if p ? 'public_contact' then s.public_contact := private.ag_opt_text(p ->> 'public_contact', 200, 'Contato'); end if;
  if p ? 'booking_policy_text' then s.booking_policy_text := private.ag_opt_text(p ->> 'booking_policy_text', 1000, 'Política'); end if;
  if p ? 'minimum_notice_minutes' then s.minimum_notice_minutes := (p ->> 'minimum_notice_minutes')::integer; end if;
  if p ? 'booking_horizon_days' then s.booking_horizon_days := (p ->> 'booking_horizon_days')::integer; end if;
  if p ? 'slot_step_minutes' then s.slot_step_minutes := (p ->> 'slot_step_minutes')::integer; end if;
  if p ? 'customer_cancellation_notice_minutes' then s.customer_cancellation_notice_minutes := (p ->> 'customer_cancellation_notice_minutes')::integer; end if;
  if p ? 'customer_rescheduling_notice_minutes' then s.customer_rescheduling_notice_minutes := (p ->> 'customer_rescheduling_notice_minutes')::integer; end if;
  update public.scheduling_settings set timezone = s.timezone, public_booking_enabled = s.public_booking_enabled, public_display_name = s.public_display_name, primary_color = s.primary_color,
    public_description = s.public_description, public_contact = s.public_contact, booking_policy_text = s.booking_policy_text, minimum_notice_minutes = s.minimum_notice_minutes,
    booking_horizon_days = s.booking_horizon_days, slot_step_minutes = s.slot_step_minutes, customer_cancellation_notice_minutes = s.customer_cancellation_notice_minutes,
    customer_rescheduling_notice_minutes = s.customer_rescheduling_notice_minutes
  where organization_id = p_org;
exception when check_violation or invalid_text_representation or numeric_value_out_of_range then
  raise exception 'um dos valores informados está fora do permitido' using errcode = '22023';
end $$;

create function public.ag_set_logo(p_org uuid, p_path text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.ag_guard(p_org, 'owner');
  if p_path is not null and p_path !~ ('^' || p_org::text || '/logo-[0-9a-f]{8,32}\.(png|jpg|webp)$') then raise exception 'caminho do logotipo inválido' using errcode = '22023'; end if;
  update public.scheduling_settings set logo_path = p_path where organization_id = p_org;
end $$;

-- Pessoas da empresa que podem ser vinculadas a um profissional (papel «Membro»), com o vínculo atual. Só o proprietário.
create function public.ag_org_members(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.ag_guard(p_org, 'owner');
  return coalesce((
    select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'role', m.role, 'email', p.email, 'name', p.full_name,
      'professional_id', (select pr.id from public.professionals pr where pr.organization_id = p_org and pr.linked_user_id = m.user_id)) order by p.email)
    from public.organization_members m left join public.profiles p on p.id = m.user_id
    where m.organization_id = p_org), '[]'::jsonb);
end $$;

-- ======================================================================= horários livres para a equipe (a validação final é sempre do servidor ao gravar)
create function public.ag_slots(p_org uuid, p_prof uuid, p_svc uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.ag_guard(p_org, 'manager');
  return coalesce((select jsonb_agg(jsonb_build_object('date', local_date, 'at', starts_at) order by starts_at) from private.ag_list_slots(p_org, p_prof, p_svc, p_from, p_to, false)), '[]'::jsonb);
end $$;

commit;
