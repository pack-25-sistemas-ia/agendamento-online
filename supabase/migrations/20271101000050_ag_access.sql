-- Agendamento Online — ACESSO: perfis derivados do papel do Core + RLS somente de LEITURA. Escrita: exclusivamente funções ag_* (SECURITY DEFINER).
-- Perfis: owner (owner/admin do Core: marca, políticas, pessoas) · manager (gestor/recepção) · professional (member vinculado a um profissional ativo).
-- Quem é só «viewer» ou «member» sem vínculo não enxerga nada. Profissional enxerga apenas a própria agenda e os clientes dos próprios atendimentos.

begin;
set local check_function_bodies = off;

create function private.ag_role(org uuid) returns public.org_role
language sql stable security definer set search_path = '' as $$
  select m.role from public.organization_members m where m.organization_id = org and m.user_id = (select auth.uid());
$$;

-- Profissional vinculado ao usuário (ativo) nesta empresa.
create function private.ag_my_professional(org uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select p.id from public.professionals p where p.organization_id = org and p.linked_user_id = (select auth.uid()) and p.active limit 1;
$$;

-- owner | manager | professional | null
create function private.ag_profile(org uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case private.ag_role(org)
    when 'owner' then 'owner' when 'admin' then 'owner' when 'manager' then 'manager'
    when 'member' then case when private.ag_my_professional(org) is not null then 'professional' end
  end;
$$;
create function private.ag_is_owner(org uuid) returns boolean language sql stable security definer set search_path = '' as $$ select coalesce(private.ag_profile(org) = 'owner', false); $$;
create function private.ag_is_manager(org uuid) returns boolean language sql stable security definer set search_path = '' as $$ select coalesce(private.ag_profile(org) in ('owner', 'manager'), false); $$;

-- O cliente só é visível ao profissional se houver atendimento dele com este cliente.
create function private.ag_customer_visible(org uuid, cust uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.ag_is_manager(org) or exists (
    select 1 from public.appointments a where a.organization_id = org and a.customer_id = cust and a.professional_id = private.ag_my_professional(org));
$$;
create function private.ag_appt_visible(org uuid, appt uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.ag_is_manager(org) or exists (
    select 1 from public.appointments a where a.id = appt and a.organization_id = org and a.professional_id = private.ag_my_professional(org));
$$;
revoke all on function private.ag_role(uuid), private.ag_my_professional(uuid), private.ag_profile(uuid), private.ag_is_owner(uuid), private.ag_is_manager(uuid),
  private.ag_customer_visible(uuid, uuid), private.ag_appt_visible(uuid, uuid) from public, anon;
grant execute on function private.ag_role(uuid), private.ag_my_professional(uuid), private.ag_profile(uuid), private.ag_is_owner(uuid), private.ag_is_manager(uuid),
  private.ag_customer_visible(uuid, uuid), private.ag_appt_visible(uuid, uuid) to authenticated;

-- ======================================================================= RLS: leitura por perfil
alter table public.scheduling_settings enable row level security;
alter table public.professionals enable row level security;
alter table public.services enable row level security;
alter table public.professional_services enable row level security;
alter table public.availability_rules enable row level security;
alter table public.availability_overrides enable row level security;
alter table public.customers enable row level security;
alter table public.schedule_entries enable row level security;
alter table public.appointments enable row level security;
alter table public.appointment_events enable row level security;
alter table public.booking_management_tokens enable row level security;
alter table public.public_booking_requests enable row level security;
alter table public.booking_rate_limits enable row level security;

create policy ag_settings_read on public.scheduling_settings for select to authenticated using (private.ag_profile(organization_id) is not null);
create policy ag_professionals_read on public.professionals for select to authenticated using (private.ag_is_manager(organization_id) or id = private.ag_my_professional(organization_id));
create policy ag_services_read on public.services for select to authenticated using (private.ag_profile(organization_id) is not null);
create policy ag_prof_services_read on public.professional_services for select to authenticated using (private.ag_is_manager(organization_id) or professional_id = private.ag_my_professional(organization_id));
create policy ag_rules_read on public.availability_rules for select to authenticated using (private.ag_is_manager(organization_id) or professional_id = private.ag_my_professional(organization_id));
create policy ag_overrides_read on public.availability_overrides for select to authenticated using (private.ag_is_manager(organization_id) or professional_id = private.ag_my_professional(organization_id));
create policy ag_customers_read on public.customers for select to authenticated using (private.ag_customer_visible(organization_id, id));
create policy ag_entries_read on public.schedule_entries for select to authenticated using (private.ag_is_manager(organization_id) or professional_id = private.ag_my_professional(organization_id));
create policy ag_appointments_read on public.appointments for select to authenticated using (private.ag_is_manager(organization_id) or professional_id = private.ag_my_professional(organization_id));
create policy ag_events_read on public.appointment_events for select to authenticated using (private.ag_appt_visible(organization_id, appointment_id));
-- booking_management_tokens, public_booking_requests e booking_rate_limits: SEM política (ninguém lê pela API; só as funções ag_*).

-- Nenhum privilégio de escrita direta; leitura só nas tabelas com política.
do $$
declare t text;
begin
  foreach t in array array['scheduling_settings', 'professionals', 'services', 'professional_services', 'availability_rules', 'availability_overrides', 'customers', 'schedule_entries',
    'appointments', 'appointment_events', 'booking_management_tokens', 'public_booking_requests', 'booking_rate_limits'] loop
    execute format('revoke all on public.%I from public, anon, authenticated', t);
  end loop;
  foreach t in array array['scheduling_settings', 'professionals', 'services', 'professional_services', 'availability_rules', 'availability_overrides', 'customers', 'schedule_entries', 'appointments', 'appointment_events'] loop
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

commit;
