-- Agendamento Online — CICLO DE VIDA DOS ATENDIMENTOS: reservar, remarcar, confirmar, cancelar, concluir, não comparecimento.
-- Cada operação é UMA transação: agenda (schedule_entries) + compromisso + histórico. Conflito = exclusion constraint do banco (a checagem prévia só dá a mensagem).
-- Cancelar nunca apaga: libera a ocupação e registra o evento. Remarcar conflitante mantém a reserva original (a transação inteira é desfeita).

begin;
set local check_function_bodies = off;

create function private.ag_new_token() returns text language sql volatile set search_path = '' as $$
  select replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
$$;
create function private.ag_token_hash(p_token text) returns text language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
$$;

create function private.ag_event(p_org uuid, p_appt uuid, p_type text, p_actor_type text, p_meta jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.appointment_events (organization_id, appointment_id, event_type, actor_type, actor_user_id, safe_metadata)
  values (p_org, p_appt, p_type, p_actor_type, (select auth.uid()), coalesce(p_meta, '{}'::jsonb));
end $$;

create function private.ag_actor_type(p_org uuid) returns text language sql stable security definer set search_path = '' as $$
  select case private.ag_profile(p_org) when 'professional' then 'professional' else 'admin' end;
$$;

-- ======================================================================= reservar (administrativo ou público)
create function private.ag_book(p_org uuid, p_prof uuid, p_svc uuid, p_customer uuid, p_start timestamptz, p_source text, p_notes text, p_actor_type text, p_public boolean, p_meta jsonb default '{}'::jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare sv public.services; code text; ent uuid; appt uuid;
begin
  perform private.ag_lock(p_prof);
  code := private.ag_check_slot(p_org, p_prof, p_svc, p_start, p_public);
  if code is not null then raise exception '%', private.ag_friendly(code) using errcode = case when code = 'conflict' then '23P01' else '22023' end; end if;
  select * into sv from public.services where id = p_svc and organization_id = p_org;
  begin
    insert into public.schedule_entries (organization_id, professional_id, kind, occupied_start_at, occupied_end_at, created_by)
    values (p_org, p_prof, 'appointment', p_start - make_interval(mins => sv.buffer_before_minutes), p_start + make_interval(mins => sv.duration_minutes + sv.buffer_after_minutes), (select auth.uid()))
    returning id into ent;
  exception when exclusion_violation then
    raise exception '%', private.ag_friendly('conflict') using errcode = '23P01';
  end;
  insert into public.appointments (organization_id, schedule_entry_id, professional_id, customer_id, service_id, starts_at, ends_at, status, source,
    service_name_snapshot, duration_minutes_snapshot, buffer_before_minutes_snapshot, buffer_after_minutes_snapshot, reference_price_cents_snapshot, internal_notes, created_by)
  values (p_org, ent, p_prof, p_customer, p_svc, p_start, p_start + make_interval(mins => sv.duration_minutes), 'scheduled', p_source,
    sv.name, sv.duration_minutes, sv.buffer_before_minutes, sv.buffer_after_minutes, sv.reference_price_cents, p_notes, (select auth.uid()))
  returning id into appt;
  insert into public.appointment_events (organization_id, appointment_id, event_type, actor_type, actor_user_id, safe_metadata)
  values (p_org, appt, 'created', p_actor_type, (select auth.uid()), coalesce(p_meta, '{}'::jsonb) || jsonb_build_object('source', p_source));
  return appt;
end $$;

create function public.ag_create_appointment(p_org uuid, p_prof uuid, p_svc uuid, p_customer uuid, p_new_customer jsonb, p_start timestamptz, p_notes text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare cust uuid := p_customer;
begin
  perform private.ag_guard(p_org, 'manager');
  if p_start is null then raise exception 'informe a data e o horário' using errcode = '22023'; end if;
  if cust is null then
    if p_new_customer is null or jsonb_typeof(p_new_customer) <> 'object' then raise exception 'selecione um cliente ou informe os dados do novo cliente' using errcode = '22023'; end if;
    cust := public.ag_save_customer(p_org, null, p_new_customer ->> 'name', p_new_customer ->> 'email', p_new_customer ->> 'phone');
  elsif not exists (select 1 from public.customers where id = cust and organization_id = p_org and anonymized_at is null) then
    raise exception 'cliente não encontrado' using errcode = 'P0002';
  end if;
  return private.ag_book(p_org, p_prof, p_svc, cust, p_start, 'admin', private.ag_opt_text(p_notes, 1000, 'Notas'), private.ag_actor_type(p_org), false);
end $$;

-- ======================================================================= remarcar (atômico; mantém duração e intervalos do momento da reserva)
create function private.ag_move(p_org uuid, p_appt uuid, p_start timestamptz, p_prof uuid, p_public boolean, p_actor_type text) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.appointments; target uuid; code text; old_start timestamptz;
begin
  select * into a from public.appointments where id = p_appt and organization_id = p_org for update;
  if not found then raise exception 'atendimento não encontrado' using errcode = 'P0002'; end if;
  if a.status not in ('scheduled', 'confirmed') then raise exception 'só atendimentos pendentes ou confirmados podem ser remarcados' using errcode = '22023'; end if;
  target := coalesce(p_prof, a.professional_id);
  -- trava os dois profissionais em ordem fixa (evita impasse entre remarcações cruzadas)
  perform private.ag_lock(least(a.professional_id, target));
  if target <> a.professional_id then perform private.ag_lock(greatest(a.professional_id, target)); end if;
  code := private.ag_check_slot(p_org, target, a.service_id, p_start, p_public, a.schedule_entry_id,
    a.duration_minutes_snapshot, a.buffer_before_minutes_snapshot, a.buffer_after_minutes_snapshot, true);
  if code is not null then raise exception '%', private.ag_friendly(code) using errcode = case when code = 'conflict' then '23P01' else '22023' end; end if;
  old_start := a.starts_at;
  begin
    update public.schedule_entries set professional_id = target,
      occupied_start_at = p_start - make_interval(mins => a.buffer_before_minutes_snapshot),
      occupied_end_at = p_start + make_interval(mins => a.duration_minutes_snapshot + a.buffer_after_minutes_snapshot)
    where id = a.schedule_entry_id;
  exception when exclusion_violation then
    raise exception '%', private.ag_friendly('conflict') using errcode = '23P01';
  end;
  update public.appointments set starts_at = p_start, ends_at = p_start + make_interval(mins => a.duration_minutes_snapshot), professional_id = target where id = a.id;
  update public.booking_management_tokens set expires_at = p_start + make_interval(mins => a.duration_minutes_snapshot) + interval '30 days' where appointment_id = a.id and revoked_at is null;
  perform private.ag_event(p_org, a.id, 'rescheduled', p_actor_type,
    jsonb_build_object('from', old_start, 'to', p_start, 'professional_changed', target <> a.professional_id));
end $$;

create function public.ag_reschedule_appointment(p_org uuid, p_appt uuid, p_start timestamptz, p_prof uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.ag_guard(p_org, 'manager');
  if p_start is null then raise exception 'informe a nova data e o horário' using errcode = '22023'; end if;
  perform private.ag_move(p_org, p_appt, p_start, p_prof, false, 'admin');
end $$;

-- Horários livres para REMARCAR um atendimento: usa a duração e os intervalos do momento da reserva (snapshot) e libera o próprio horário atual.
create function public.ag_reschedule_slots(p_org uuid, p_appt uuid, p_prof uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare a public.appointments;
begin
  perform private.ag_guard(p_org, 'manager');
  select * into a from public.appointments where id = p_appt and organization_id = p_org;
  if not found or a.status not in ('scheduled', 'confirmed') then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('date', local_date, 'at', starts_at) order by starts_at)
    from private.ag_list_slots(p_org, coalesce(p_prof, a.professional_id), a.service_id, p_from, p_to, false,
      a.duration_minutes_snapshot, a.buffer_before_minutes_snapshot, a.buffer_after_minutes_snapshot, a.schedule_entry_id)), '[]'::jsonb);
end $$;

-- ======================================================================= confirmar · cancelar · concluir · não compareceu
create function private.ag_transition(p_org uuid, p_appt uuid, p_action text, p_reason text, p_actor_type text, p_via_customer boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.appointments; target text; ev text;
begin
  select * into a from public.appointments where id = p_appt and organization_id = p_org for update;
  if not found then raise exception 'atendimento não encontrado' using errcode = 'P0002'; end if;
  target := case p_action when 'confirm' then 'confirmed' when 'cancel' then 'cancelled' when 'complete' then 'completed' when 'no_show' then 'no_show' end;
  if target is null then raise exception 'ação inválida' using errcode = '22023'; end if;
  if a.status = target then raise exception 'o atendimento já está neste estado' using errcode = '22023'; end if;
  if not ((a.status = 'scheduled' and target in ('confirmed', 'cancelled', 'completed', 'no_show')) or (a.status = 'confirmed' and target in ('cancelled', 'completed', 'no_show'))) then
    raise exception 'esta ação não é possível para um atendimento %', case a.status when 'completed' then 'concluído' when 'no_show' then 'com não comparecimento' when 'cancelled' then 'cancelado' else a.status end using errcode = '22023';
  end if;
  if target in ('completed', 'no_show') and now() < a.starts_at then raise exception 'só é possível registrar depois do horário do atendimento' using errcode = '22023'; end if;
  if target = 'cancelled' then
    perform private.ag_lock(a.professional_id);
    update public.schedule_entries set active = false where id = a.schedule_entry_id;
    -- o link NÃO é revogado: o cliente continua vendo a reserva como «Cancelada» (sem ações). Só expira (30 dias após o fim) ou é revogado na anonimização.
  end if;
  update public.appointments set status = target, cancellation_reason = case when target = 'cancelled' then private.ag_opt_text(p_reason, 300, 'Motivo') else cancellation_reason end where id = a.id;
  ev := case target when 'confirmed' then 'confirmed' when 'cancelled' then 'cancelled' when 'completed' then 'completed' else 'no_show' end;
  perform private.ag_event(p_org, a.id, ev, p_actor_type, jsonb_build_object('from', a.status, 'via_link', p_via_customer));
end $$;

create function public.ag_set_status(p_org uuid, p_appt uuid, p_action text, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare prof uuid;
begin
  perform private.ag_guard(p_org, 'staff');
  if private.ag_profile(p_org) = 'professional' then
    select professional_id into prof from public.appointments where id = p_appt and organization_id = p_org;
    if prof is distinct from private.ag_my_professional(p_org) then raise exception 'atendimento não encontrado' using errcode = 'P0002'; end if;
    if p_action not in ('complete', 'no_show') then raise exception 'sem permissão para esta ação' using errcode = '42501'; end if;
  end if;
  perform private.ag_transition(p_org, p_appt, p_action, p_reason, private.ag_actor_type(p_org));
end $$;

create function public.ag_update_notes(p_org uuid, p_appt uuid, p_notes text) returns void
language plpgsql security definer set search_path = '' as $$
declare prof uuid;
begin
  perform private.ag_guard(p_org, 'staff');
  select professional_id into prof from public.appointments where id = p_appt and organization_id = p_org;
  if not found then raise exception 'atendimento não encontrado' using errcode = 'P0002'; end if;
  if private.ag_profile(p_org) = 'professional' and prof is distinct from private.ag_my_professional(p_org) then raise exception 'atendimento não encontrado' using errcode = 'P0002'; end if;
  update public.appointments set internal_notes = private.ag_opt_text(p_notes, 1000, 'Notas') where id = p_appt;
  perform private.ag_event(p_org, p_appt, 'notes_updated', private.ag_actor_type(p_org));
end $$;

-- Cliente perdeu o link: a equipe emite outro (o anterior deixa de valer). O texto do link só existe nesta resposta.
create function public.ag_reissue_link(p_org uuid, p_appt uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.appointments; tok text := private.ag_new_token(); exp timestamptz;
begin
  perform private.ag_guard(p_org, 'manager');
  select * into a from public.appointments where id = p_appt and organization_id = p_org for update;
  if not found then raise exception 'atendimento não encontrado' using errcode = 'P0002'; end if;
  if a.status not in ('scheduled', 'confirmed') then raise exception 'só atendimentos pendentes ou confirmados têm link de gerenciamento' using errcode = '22023'; end if;
  update public.booking_management_tokens set revoked_at = now() where appointment_id = a.id and revoked_at is null;
  exp := a.ends_at + interval '30 days';
  insert into public.booking_management_tokens (organization_id, appointment_id, token_hash, expires_at) values (p_org, a.id, private.ag_token_hash(tok), exp);
  perform private.ag_event(p_org, a.id, 'link_reissued', 'admin');
  return jsonb_build_object('token', tok, 'expires_at', exp);
end $$;

-- ======================================================================= painel operacional (INVOKER: a RLS limita o profissional à própria agenda)
create function public.ag_dashboard(p_org uuid, p_from date, p_to date, p_prof uuid) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare tz text := private.ag_tz(p_org); today date := private.ag_today(p_org); res jsonb; comp bigint; ns bigint;
begin
  if (select auth.uid()) is null or private.ag_profile(p_org) is null then raise exception 'sem permissão' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then raise exception 'período inválido' using errcode = '22023'; end if;
  select count(*) filter (where status = 'completed'), count(*) filter (where status = 'no_show') into comp, ns
  from public.appointments a where a.organization_id = p_org and (p_prof is null or a.professional_id = p_prof) and (a.starts_at at time zone tz)::date between p_from and p_to;
  res := jsonb_build_object(
    'timezone', tz, 'today', today,
    'today_count', (select count(*) from public.appointments a where a.organization_id = p_org and (p_prof is null or a.professional_id = p_prof) and a.status <> 'cancelled' and (a.starts_at at time zone tz)::date = today),
    'pending_confirmation', (select count(*) from public.appointments a where a.organization_id = p_org and (p_prof is null or a.professional_id = p_prof) and a.status = 'scheduled' and a.starts_at >= now()),
    'completed', comp, 'no_show', ns,
    'cancelled', (select count(*) from public.appointments a where a.organization_id = p_org and (p_prof is null or a.professional_id = p_prof) and a.status = 'cancelled' and (a.starts_at at time zone tz)::date between p_from and p_to),
    'no_show_rate', case when comp + ns = 0 then null else round(ns * 100.0 / (comp + ns), 1) end,
    'upcoming', coalesce((select jsonb_agg(x order by (x ->> 'starts_at')) from (
        select jsonb_build_object('id', a.id, 'starts_at', a.starts_at, 'status', a.status, 'customer', c.name, 'service', a.service_name_snapshot, 'professional', p.name) x
        from public.appointments a join public.customers c on c.id = a.customer_id join public.professionals p on p.id = a.professional_id
        where a.organization_id = p_org and (p_prof is null or a.professional_id = p_prof) and a.status in ('scheduled', 'confirmed') and a.starts_at >= now()
        order by a.starts_at limit 8) q), '[]'::jsonb),
    'by_service', coalesce((select jsonb_agg(jsonb_build_object('name', n, 'count', k) order by k desc, n) from (
        select a.service_name_snapshot n, count(*) k from public.appointments a
        where a.organization_id = p_org and (p_prof is null or a.professional_id = p_prof) and a.status <> 'cancelled' and (a.starts_at at time zone tz)::date between p_from and p_to
        group by 1 order by 2 desc, 1 limit 8) q), '[]'::jsonb),
    'by_professional', coalesce((select jsonb_agg(jsonb_build_object('name', n, 'count', k) order by k desc, n) from (
        select p.name n, count(*) k from public.appointments a join public.professionals p on p.id = a.professional_id
        where a.organization_id = p_org and (p_prof is null or a.professional_id = p_prof) and a.status <> 'cancelled' and (a.starts_at at time zone tz)::date between p_from and p_to
        group by 1 order by 2 desc, 1 limit 12) q), '[]'::jsonb),
    'by_status', coalesce((select jsonb_object_agg(s, k) from (
        select a.status s, count(*) k from public.appointments a
        where a.organization_id = p_org and (p_prof is null or a.professional_id = p_prof) and (a.starts_at at time zone tz)::date between p_from and p_to group by 1) q), '{}'::jsonb));
  return res;
end $$;

create function public.ag_log_export(p_org uuid, p_kind text, p_rows integer) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.ag_guard(p_org, 'manager');
  if char_length(coalesce(p_kind, '')) not between 1 and 60 then raise exception 'tipo inválido' using errcode = '22023'; end if;
  perform private.ag_audit(p_org, 'export', 'report', null, jsonb_build_object('kind', p_kind, 'rows', greatest(0, least(coalesce(p_rows, 0), 1000000))));
end $$;

revoke all on function private.ag_new_token(), private.ag_token_hash(text), private.ag_event(uuid, uuid, text, text, jsonb), private.ag_actor_type(uuid),
  private.ag_book(uuid, uuid, uuid, uuid, timestamptz, text, text, text, boolean, jsonb), private.ag_move(uuid, uuid, timestamptz, uuid, boolean, text),
  private.ag_transition(uuid, uuid, text, text, text, boolean) from public, anon, authenticated;

commit;
