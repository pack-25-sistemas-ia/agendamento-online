-- Agendamento Online — OPERAÇÕES PÚBLICAS (sem login). São as ÚNICAS funções liberadas ao papel anon, todas estreitas:
--   página pública · horários livres · reservar · consultar/cancelar/remarcar pelo link seguro.
-- Nunca devolvem clientes, outras reservas, notas internas, motivos de bloqueio nem ids administrativos (organização, usuários).
-- O token do link tem 256 bits de entropia e só o HASH (sha256) é guardado: quem lê o banco não consegue usar o link.
-- Falhas de token respondem sempre igual (inválido, expirado ou revogado), sem revelar qual.

begin;
set local check_function_bodies = off;

create function private.ag_public_org(p_slug text) returns uuid
language sql stable security definer set search_path = '' as $$
  select o.id from public.organizations o join public.scheduling_settings s on s.organization_id = o.id
  where o.slug = lower(btrim(coalesce(p_slug, ''))) and s.public_booking_enabled;
$$;

-- Dados mínimos de uma reserva para o próprio cliente.
create function private.ag_booking_dto(a public.appointments) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare st public.scheduling_settings; o public.organizations; pname text; active boolean := a.status in ('scheduled', 'confirmed');
  cdl timestamptz; rdl timestamptz;
begin
  select * into st from public.scheduling_settings where organization_id = a.organization_id;
  select * into o from public.organizations where id = a.organization_id;
  select name into pname from public.professionals where id = a.professional_id;
  cdl := a.starts_at - make_interval(mins => st.customer_cancellation_notice_minutes);
  rdl := a.starts_at - make_interval(mins => st.customer_rescheduling_notice_minutes);
  return jsonb_build_object(
    'status', a.status, 'starts_at', a.starts_at, 'ends_at', a.ends_at, 'service', a.service_name_snapshot, 'duration_minutes', a.duration_minutes_snapshot,
    'price_cents', a.reference_price_cents_snapshot, 'professional', pname, 'business', coalesce(st.public_display_name, o.name), 'contact', st.public_contact,
    'policy', st.booking_policy_text, 'timezone', st.timezone, 'color', st.primary_color,
    'can_cancel', active and now() <= cdl, 'cancel_deadline', cdl, 'can_reschedule', active and now() <= rdl, 'reschedule_deadline', rdl);
end $$;

-- Localiza a reserva do link (trava a linha). NULL = inválido, expirado ou revogado.
create function private.ag_by_token(p_token text, p_lock boolean default false) returns public.appointments
language plpgsql security definer set search_path = '' as $$
declare a public.appointments;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{40,128}$' then return null; end if;
  select ap.* into a from public.booking_management_tokens t join public.appointments ap on ap.id = t.appointment_id and ap.organization_id = t.organization_id
  where t.token_hash = private.ag_token_hash(p_token) and t.revoked_at is null and t.expires_at > now();
  if not found then return null; end if;
  if p_lock then select * into a from public.appointments where id = a.id for update; end if;
  return a;
end $$;

-- ======================================================================= página pública
create function public.ag_public_page(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare org uuid := private.ag_public_org(p_slug); st public.scheduling_settings; o public.organizations;
begin
  if org is null then return null; end if;
  select * into st from public.scheduling_settings where organization_id = org;
  select * into o from public.organizations where id = org;
  return jsonb_build_object(
    'name', coalesce(st.public_display_name, o.name), 'description', st.public_description, 'contact', st.public_contact, 'policy', st.booking_policy_text,
    'timezone', st.timezone, 'color', st.primary_color, 'has_logo', st.logo_path is not null, 'horizon_days', st.booking_horizon_days,
    'cancel_notice_minutes', st.customer_cancellation_notice_minutes, 'reschedule_notice_minutes', st.customer_rescheduling_notice_minutes,
    'services', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'description', s.description, 'duration', s.duration_minutes, 'price_cents', s.reference_price_cents,
        'professionals', (select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'bio', p.public_bio, 'color', p.display_color) order by p.name)
                          from public.professional_services ps join public.professionals p on p.id = ps.professional_id and p.organization_id = ps.organization_id
                          where ps.service_id = s.id and p.active)) order by s.name)
      from public.services s where s.organization_id = org and s.active and s.public_booking_enabled
        and exists (select 1 from public.professional_services ps join public.professionals p on p.id = ps.professional_id where ps.service_id = s.id and p.active)), '[]'::jsonb));
end $$;

-- Caminho do logotipo (a rota do app serve o arquivo; o caminho contém o id da empresa e nunca vai ao navegador).
create function public.ag_public_logo_path(p_slug text) returns text
language sql stable security definer set search_path = '' as $$
  select s.logo_path from public.scheduling_settings s where s.organization_id = private.ag_public_org(p_slug);
$$;

create function private.ag_slots_json(p_org uuid, p_prof uuid, p_svc uuid, p_from date, p_to date, p_duration integer, p_bb integer, p_ba integer, p_ignore uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('date', d, 'times', t) order by d), '[]'::jsonb)
  from (select local_date d, jsonb_agg(starts_at order by starts_at) t from private.ag_list_slots(p_org, p_prof, p_svc, p_from, p_to, true, p_duration, p_bb, p_ba, p_ignore) group by local_date) q;
$$;

create function public.ag_public_slots(p_slug text, p_svc uuid, p_prof uuid, p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare org uuid := private.ag_public_org(p_slug);
begin
  if org is null then return null; end if;
  perform private.ag_rate_hit('slots:' || org::text, 600, 60);
  if p_from is null or p_to is null then raise exception 'informe o período' using errcode = '22023'; end if;
  if not exists (select 1 from public.services where id = p_svc and organization_id = org and active and public_booking_enabled) then
    return jsonb_build_object('timezone', private.ag_tz(org), 'days', '[]'::jsonb);
  end if;
  return jsonb_build_object('timezone', private.ag_tz(org), 'days', private.ag_slots_json(org, p_prof, p_svc, p_from, least(p_to, p_from + 30), null, null, null, null));
end $$;

-- ======================================================================= reservar
create function private.ag_clean_phone(p text) returns text language plpgsql immutable set search_path = '' as $$
declare ph text := nullif(btrim(coalesce(p, '')), '');
begin
  if ph is null then return null; end if;
  if ph !~ '^[0-9+()\s.-]{8,30}$' or char_length(regexp_replace(ph, '\D', '', 'g')) not between 8 and 15 then raise exception 'telefone inválido (use DDD e número)' using errcode = '22023'; end if;
  return ph;
end $$;
create function private.ag_clean_email(p text) returns text language plpgsql immutable set search_path = '' as $$
declare em text := nullif(lower(btrim(coalesce(p, ''))), '');
begin
  if em is null then return null; end if;
  if char_length(em) > 200 or em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'e-mail inválido' using errcode = '22023'; end if;
  return em;
end $$;

-- p_token: gerado pelo servidor do app de forma determinística a partir da chave de idempotência (HMAC), para que um reenvio devolva o MESMO link.
create function public.ag_public_book(p_slug text, p_svc uuid, p_prof uuid, p_start timestamptz, p_name text, p_phone text, p_email text, p_consent boolean,
  p_idem uuid, p_token text, p_client text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  org uuid := private.ag_public_org(p_slug); nm text; ph text; em text; rh text; ins integer; req public.public_booking_requests; cust uuid; appt uuid; a public.appointments; exp timestamptz;
begin
  if org is null then raise exception 'página de reservas indisponível' using errcode = 'P0002'; end if;
  if p_idem is null then raise exception 'solicitação inválida' using errcode = '22023'; end if;
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{40,128}$' then raise exception 'solicitação inválida' using errcode = '22023'; end if;
  if not coalesce(p_consent, false) then raise exception 'confirme que está de acordo com o uso dos seus dados para a reserva' using errcode = '22023'; end if;
  nm := private.ag_req_text(p_name, 2, 120, 'Nome');
  ph := private.ag_clean_phone(p_phone); em := private.ag_clean_email(p_email);
  if ph is null and em is null then raise exception 'informe um telefone ou e-mail para contato' using errcode = '22023'; end if;
  if p_start is null then raise exception 'escolha o horário' using errcode = '22023'; end if;
  rh := encode(sha256(convert_to(concat_ws('|', p_svc, p_prof, extract(epoch from p_start)::bigint, lower(nm), regexp_replace(coalesce(ph, ''), '\D', '', 'g'), coalesce(em, '')), 'UTF8')), 'hex');

  -- reenvio com a mesma chave: mesma reserva (se o conteúdo for o mesmo)
  insert into public.public_booking_requests (organization_id, idempotency_key, request_hash) values (org, p_idem, rh) on conflict do nothing;
  get diagnostics ins = row_count;
  if ins = 0 then
    select * into req from public.public_booking_requests where organization_id = org and idempotency_key = p_idem;
    if req.request_hash <> rh then raise exception 'esta solicitação já foi usada com outros dados; recarregue a página' using errcode = '22023'; end if;
    if req.appointment_id is not null then
      select * into a from public.appointments where id = req.appointment_id;
      return private.ag_booking_dto(a) || jsonb_build_object('replayed', true);
    end if;
    raise exception 'solicitação em andamento; aguarde alguns segundos' using errcode = '55000';
  end if;

  perform private.ag_rate_hit('book:org:' || org::text, 120, 600);
  perform private.ag_rate_hit('book:contact:' || org::text || ':' || md5(coalesce(regexp_replace(ph, '\D', '', 'g'), '') || '|' || coalesce(em, '')), 6, 3600);
  if p_client is not null then perform private.ag_rate_hit('book:client:' || org::text || ':' || left(p_client, 64), 30, 3600); end if;

  if not exists (select 1 from public.services where id = p_svc and organization_id = org and active and public_booking_enabled) then raise exception '%', private.ag_friendly('service') using errcode = '22023'; end if;
  insert into public.customers (organization_id, name, email, phone) values (org, nm, em, ph) returning id into cust;
  appt := private.ag_book(org, p_prof, p_svc, cust, p_start, 'public', null, 'customer', true, jsonb_build_object('consent', true));
  select * into a from public.appointments where id = appt;
  exp := a.ends_at + interval '30 days';
  insert into public.booking_management_tokens (organization_id, appointment_id, token_hash, expires_at) values (org, appt, private.ag_token_hash(p_token), exp);
  update public.public_booking_requests set appointment_id = appt where organization_id = org and idempotency_key = p_idem;
  return private.ag_booking_dto(a) || jsonb_build_object('replayed', false);
exception when unique_violation then
  raise exception 'não foi possível concluir a reserva; tente novamente' using errcode = '55000';
end $$;

-- ======================================================================= gerenciar pelo link
create function public.ag_public_get_booking(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.appointments;
begin
  a := private.ag_by_token(p_token);
  if a.id is null then return null; end if;
  return private.ag_booking_dto(a);
end $$;

create function public.ag_public_cancel(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.appointments; st public.scheduling_settings;
begin
  a := private.ag_by_token(p_token, true);
  if a.id is null then raise exception 'link inválido ou expirado' using errcode = 'P0002'; end if;
  perform private.ag_rate_hit('tok:' || left(private.ag_token_hash(p_token), 24), 20, 600);
  select * into st from public.scheduling_settings where organization_id = a.organization_id;
  if a.status not in ('scheduled', 'confirmed') then raise exception 'esta reserva não pode mais ser cancelada pelo link' using errcode = '22023'; end if;
  if now() > a.starts_at - make_interval(mins => st.customer_cancellation_notice_minutes) then
    raise exception 'o prazo para cancelar pelo link terminou; entre em contato com a empresa' using errcode = '22023';
  end if;
  perform private.ag_transition(a.organization_id, a.id, 'cancel', 'Cancelado pelo cliente', 'customer', true);
  select * into a from public.appointments where id = a.id;
  return private.ag_booking_dto(a);
end $$;

create function public.ag_public_booking_slots(p_token text, p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.appointments;
begin
  a := private.ag_by_token(p_token);
  if a.id is null or a.status not in ('scheduled', 'confirmed') then return null; end if;
  perform private.ag_rate_hit('tok:' || left(private.ag_token_hash(p_token), 24), 60, 600);
  return jsonb_build_object('timezone', private.ag_tz(a.organization_id), 'days', private.ag_slots_json(a.organization_id, a.professional_id, a.service_id, p_from, least(p_to, p_from + 30),
    a.duration_minutes_snapshot, a.buffer_before_minutes_snapshot, a.buffer_after_minutes_snapshot, a.schedule_entry_id));
end $$;

create function public.ag_public_reschedule(p_token text, p_start timestamptz) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.appointments; st public.scheduling_settings;
begin
  a := private.ag_by_token(p_token, true);
  if a.id is null then raise exception 'link inválido ou expirado' using errcode = 'P0002'; end if;
  perform private.ag_rate_hit('tok:' || left(private.ag_token_hash(p_token), 24), 20, 600);
  select * into st from public.scheduling_settings where organization_id = a.organization_id;
  if a.status not in ('scheduled', 'confirmed') then raise exception 'esta reserva não pode mais ser remarcada pelo link' using errcode = '22023'; end if;
  if now() > a.starts_at - make_interval(mins => st.customer_rescheduling_notice_minutes) then
    raise exception 'o prazo para remarcar pelo link terminou; entre em contato com a empresa' using errcode = '22023';
  end if;
  if p_start is null then raise exception 'escolha o novo horário' using errcode = '22023'; end if;
  perform private.ag_move(a.organization_id, a.id, p_start, null, true, 'customer');
  select * into a from public.appointments where id = a.id;
  return private.ag_booking_dto(a);
end $$;

revoke all on function private.ag_public_org(text), private.ag_booking_dto(public.appointments), private.ag_by_token(text, boolean), private.ag_slots_json(uuid, uuid, uuid, date, date, integer, integer, integer, uuid),
  private.ag_clean_phone(text), private.ag_clean_email(text) from public, anon, authenticated;

commit;
