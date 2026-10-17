-- Agendamento Online — GUARDAS: padrões por empresa, guard de função, auditoria, imutabilidade e consistência compromisso × agenda.
-- Estas travas valem até para o dono do schema (são triggers): nenhuma função, presente ou futura, grava um estado inconsistente.

begin;
set local check_function_bodies = off;

create function private.ag_tz(org uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select s.timezone from public.scheduling_settings s where s.organization_id = org), 'America/Sao_Paulo');
$$;
create function private.ag_today(org uuid) returns date
language sql stable set search_path = '' as $$ select (now() at time zone private.ag_tz(org))::date; $$;

-- ======================================================================= padrões por empresa (também para as já existentes)
create function private.ag_bootstrap_org(org uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.scheduling_settings (organization_id) values (org) on conflict do nothing;
end $$;
revoke all on function private.ag_bootstrap_org(uuid) from public, anon, authenticated;
create function private.ag_on_org_created() returns trigger language plpgsql security definer set search_path = '' as $$
begin perform private.ag_bootstrap_org(new.id); return null; end $$;
revoke all on function private.ag_on_org_created() from public, anon, authenticated;
create trigger ag_on_org_created after insert on public.organizations for each row execute function private.ag_on_org_created();
select private.ag_bootstrap_org(id) from public.organizations;

-- ======================================================================= guard: sessão + MFA + perfil (toda função ag_ administrativa começa por aqui)
-- níveis: owner · manager (owner+gestor) · staff (qualquer perfil com acesso)
create function private.ag_guard(p_org uuid, p_level text) returns void
language plpgsql stable security definer set search_path = '' as $$
declare ok boolean;
begin
  if (select auth.uid()) is null then raise exception 'sessão inválida' using errcode = '28000'; end if;
  if not private.mfa_ok() then raise exception 'verificação em duas etapas necessária' using errcode = '42501'; end if;
  ok := case p_level
    when 'owner' then private.ag_is_owner(p_org)
    when 'manager' then private.ag_is_manager(p_org)
    else private.ag_profile(p_org) is not null end;
  if not ok then raise exception 'sem permissão' using errcode = '42501'; end if;
end $$;
revoke all on function private.ag_guard(uuid, text) from public, anon;
grant execute on function private.ag_guard(uuid, text) to authenticated;

create function private.ag_audit(p_org uuid, p_action text, p_entity text, p_entity_id uuid, p_changes jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_log (organization_id, actor_id, action, entity, entity_id, changes) values (p_org, (select auth.uid()), p_action, p_entity, p_entity_id::text, p_changes);
end $$;
revoke all on function private.ag_audit(uuid, text, text, uuid, jsonb) from public, anon, authenticated;

-- ======================================================================= updated_at, auditoria (só metadados) e organização imutável
do $$
declare t text;
begin
  foreach t in array array['scheduling_settings', 'professionals', 'services', 'customers', 'appointments'] loop
    execute format('create trigger %I before update on public.%I for each row execute function private.set_updated_at()', 'upd_' || t, t);
  end loop;
  foreach t in array array['scheduling_settings', 'professionals', 'services', 'professional_services', 'availability_rules', 'availability_overrides', 'customers', 'appointments'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_trigger(%L, %L)',
      'audit_' || t, t, 'organization_id', case t when 'scheduling_settings' then 'organization_id' when 'professional_services' then 'service_id' else 'id' end);
  end loop;
end $$;

create function private.ag_org_immutable() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.organization_id is distinct from old.organization_id then raise exception 'a organização do registro não pode mudar' using errcode = '23514'; end if;
  return new;
end $$;
revoke all on function private.ag_org_immutable() from public, anon, authenticated;
do $$
declare t text;
begin
  foreach t in array array['professionals', 'services', 'customers', 'schedule_entries', 'appointments', 'availability_rules', 'availability_overrides'] loop
    execute format('create trigger %I before update on public.%I for each row execute function private.ag_org_immutable()', 'orgimm_' || t, t);
  end loop;
end $$;

-- ======================================================================= imutabilidade: histórico nunca se apaga nem se reescreve
create function private.ag_no_delete() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'registro não pode ser apagado (histórico preservado): %', tg_table_name using errcode = '23514'; end $$;
create function private.ag_append_only() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'registro imutável: %', tg_table_name using errcode = '23514'; end $$;
revoke all on function private.ag_no_delete() from public, anon, authenticated;
revoke all on function private.ag_append_only() from public, anon, authenticated;
do $$
declare t text;
begin
  foreach t in array array['professionals', 'services', 'customers', 'schedule_entries', 'appointments', 'appointment_events', 'booking_management_tokens'] loop
    execute format('create trigger %I before delete on public.%I for each row execute function private.ag_no_delete()', 'nodel_' || t, t);
  end loop;
end $$;
create trigger appt_events_append_only before update on public.appointment_events for each row execute function private.ag_append_only();

-- Compromisso: identidade, cliente, serviço, origem e snapshots NUNCA mudam; só estado, horário (enquanto ativo), profissional e notas.
create function private.ag_appointment_guard() returns trigger language plpgsql set search_path = '' as $$
declare keep text[] := array['status', 'starts_at', 'ends_at', 'professional_id', 'internal_notes', 'cancellation_reason', 'updated_at'];
begin
  if (to_jsonb(new) - keep) is distinct from (to_jsonb(old) - keep) then
    raise exception 'campos do compromisso são imutáveis (cliente, serviço, origem e valores do momento da reserva)' using errcode = '23514';
  end if;
  if new.status is distinct from old.status and not (
       (old.status = 'scheduled' and new.status in ('confirmed', 'cancelled', 'completed', 'no_show'))
    or (old.status = 'confirmed' and new.status in ('cancelled', 'completed', 'no_show'))) then
    raise exception 'transição de status inválida: % → %', old.status, new.status using errcode = '23514';
  end if;
  if (new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at or new.professional_id is distinct from old.professional_id)
     and old.status not in ('scheduled', 'confirmed') then
    raise exception 'só compromissos ativos podem ser reagendados' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function private.ag_appointment_guard() from public, anon, authenticated;
create trigger appointment_guard before update on public.appointments for each row execute function private.ag_appointment_guard();

-- Consistência compromisso × agenda (conferida no COMMIT, por QUALQUER caminho): a ocupação é [início − buffer anterior, fim + buffer posterior) e só está ativa se o compromisso não foi cancelado.
-- Sempre valida o estado ATUAL (o evento adiado carrega uma versão antiga da linha; a mesma linha pode mudar várias vezes na transação).
create function private.ag_check_appointment(p_id uuid) returns void language plpgsql security definer set search_path = '' as $$
declare e public.schedule_entries; cur public.appointments;
begin
  select * into cur from public.appointments where id = p_id;
  if not found then return; end if;
  select * into e from public.schedule_entries where id = cur.schedule_entry_id;
  if not found or e.kind <> 'appointment' or e.organization_id <> cur.organization_id or e.professional_id <> cur.professional_id then
    raise exception 'compromisso sem ocupação correspondente na agenda' using errcode = '23514';
  end if;
  if cur.ends_at <> cur.starts_at + make_interval(mins => cur.duration_minutes_snapshot) then
    raise exception 'duração do compromisso diverge do serviço reservado' using errcode = '23514';
  end if;
  if e.occupied_start_at <> cur.starts_at - make_interval(mins => cur.buffer_before_minutes_snapshot)
     or e.occupied_end_at <> cur.ends_at + make_interval(mins => cur.buffer_after_minutes_snapshot) then
    raise exception 'ocupação da agenda diverge do compromisso (horário e intervalos)' using errcode = '23514';
  end if;
  if e.active <> (cur.status <> 'cancelled') then
    raise exception 'ocupação ativa deve acompanhar o status do compromisso' using errcode = '23514';
  end if;
end $$;
create function private.ag_appointment_consistency() returns trigger language plpgsql security definer set search_path = '' as $$
begin perform private.ag_check_appointment(new.id); return null; end $$;
create function private.ag_entry_consistency() returns trigger language plpgsql security definer set search_path = '' as $$
declare a uuid;
begin
  if new.kind = 'appointment' then
    select id into a from public.appointments where schedule_entry_id = new.id;
    if a is not null then perform private.ag_check_appointment(a); end if;
  end if;
  return null;
end $$;
revoke all on function private.ag_check_appointment(uuid), private.ag_appointment_consistency(), private.ag_entry_consistency() from public, anon, authenticated;
create constraint trigger appointment_consistency after insert or update on public.appointments deferrable initially deferred for each row execute function private.ag_appointment_consistency();
create constraint trigger entry_consistency after update on public.schedule_entries deferrable initially deferred for each row execute function private.ag_entry_consistency();

-- A ocupação de um compromisso nunca é desativada, movida nem trocada de tipo fora do compromisso (cobre quem tentar via outro caminho).
create function private.ag_entry_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.kind is distinct from old.kind or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception 'tipo e autoria da ocupação são imutáveis' using errcode = '23514';
  end if;
  if old.kind = 'block' and (new.occupied_start_at is distinct from old.occupied_start_at or new.occupied_end_at is distinct from old.occupied_end_at or new.professional_id is distinct from old.professional_id) then
    raise exception 'bloqueio não é reagendado: cancele e crie outro' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function private.ag_entry_guard() from public, anon, authenticated;
create trigger entry_guard before update on public.schedule_entries for each row execute function private.ag_entry_guard();

-- Dia fechado não convive com intervalos na mesma data.
create function private.ag_override_consistency() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.availability_overrides c where c.professional_id = new.professional_id and c.local_date = new.local_date and c.local_start_time is null)
     and exists (select 1 from public.availability_overrides i where i.professional_id = new.professional_id and i.local_date = new.local_date and i.local_start_time is not null) then
    raise exception 'uma data fechada não pode ter intervalos de atendimento' using errcode = '23514';
  end if;
  return null;
end $$;
revoke all on function private.ag_override_consistency() from public, anon, authenticated;
create constraint trigger override_consistency after insert or update on public.availability_overrides deferrable initially deferred for each row execute function private.ag_override_consistency();

commit;
