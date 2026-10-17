-- Agendamento Online — SCHEMA. Organizações, membros, papéis e auditoria vêm do Core; aqui entram agenda, profissionais, serviços, disponibilidade e reservas.
-- O Core já possui `organization_settings` (nome de exibição e tema do painel); as políticas de agendamento ficam em `scheduling_settings`.
-- Convenções: instantes em timestamptz; horários da semana em hora local da empresa (fuso IANA em scheduling_settings); dinheiro em centavos;
-- relacionamentos por chave composta (id, organization_id): nenhum registro referencia outra empresa. Escrita só por funções ag_* (ver migrações seguintes).

begin;
set local check_function_bodies = off;

create extension if not exists btree_gist;

-- ======================================================================= políticas e identidade pública da empresa
create table public.scheduling_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  timezone text not null default 'America/Sao_Paulo' check (timezone ~ '^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+)*$' and char_length(timezone) <= 60),
  public_booking_enabled boolean not null default false,
  public_display_name text check (char_length(btrim(public_display_name)) between 2 and 80),
  logo_path text check (char_length(logo_path) <= 200),
  primary_color text not null default '#1d4ed8' check (primary_color ~ '^#[0-9a-fA-F]{6}$'),
  public_description text check (char_length(public_description) <= 500),
  public_contact text check (char_length(public_contact) <= 200),
  minimum_notice_minutes integer not null default 120 check (minimum_notice_minutes between 0 and 43200),
  booking_horizon_days integer not null default 60 check (booking_horizon_days between 1 and 365),
  slot_step_minutes integer not null default 30 check (slot_step_minutes in (5, 10, 15, 20, 30, 60)),
  customer_cancellation_notice_minutes integer not null default 1440 check (customer_cancellation_notice_minutes between 0 and 43200),
  customer_rescheduling_notice_minutes integer not null default 1440 check (customer_rescheduling_notice_minutes between 0 and 43200),
  booking_policy_text text check (char_length(booking_policy_text) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ======================================================================= profissionais, serviços e vínculo
create table public.professionals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  linked_user_id uuid references auth.users(id) on delete set null,
  name text not null check (char_length(btrim(name)) between 2 and 80),
  public_bio text check (char_length(public_bio) <= 300),
  display_color text not null default '#2563eb' check (display_color ~ '^#[0-9a-fA-F]{6}$'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);
create unique index professionals_user_uniq on public.professionals (organization_id, linked_user_id) where linked_user_id is not null;
create index professionals_org_idx on public.professionals (organization_id, active);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 80),
  description text check (char_length(description) <= 400),
  duration_minutes integer not null check (duration_minutes between 5 and 720),
  buffer_before_minutes integer not null default 0 check (buffer_before_minutes between 0 and 240),
  buffer_after_minutes integer not null default 0 check (buffer_after_minutes between 0 and 240),
  reference_price_cents bigint check (reference_price_cents between 0 and 100000000),
  active boolean not null default true,
  public_booking_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);
create index services_org_idx on public.services (organization_id, active);

create table public.professional_services (
  organization_id uuid not null,
  professional_id uuid not null,
  service_id uuid not null,
  primary key (professional_id, service_id),
  foreign key (professional_id, organization_id) references public.professionals (id, organization_id) on delete cascade,
  foreign key (service_id, organization_id) references public.services (id, organization_id) on delete cascade
);
create index professional_services_service_idx on public.professional_services (service_id);

-- ======================================================================= disponibilidade (hora LOCAL da empresa)
-- weekday: 0 = domingo … 6 = sábado. Vários intervalos por dia; intervalos ativos do mesmo dia não se sobrepõem (exclusão no banco).
create table public.availability_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  professional_id uuid not null,
  weekday smallint not null check (weekday between 0 and 6),
  local_start_time time not null,
  local_end_time time not null,
  start_min integer generated always as ((extract(hour from local_start_time) * 60 + extract(minute from local_start_time))::integer) stored,
  end_min integer generated always as ((extract(hour from local_end_time) * 60 + extract(minute from local_end_time))::integer) stored,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (local_start_time < local_end_time),
  foreign key (professional_id, organization_id) references public.professionals (id, organization_id) on delete cascade,
  exclude using gist (professional_id with =, weekday with =, int4range(start_min, end_min) with &&) where (active)
);
create index availability_rules_prof_idx on public.availability_rules (professional_id, weekday);

-- Exceção por data: os intervalos da data SUBSTITUEM a regra semanal daquele dia. Linha sem horários = dia fechado.
create table public.availability_overrides (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  professional_id uuid not null,
  local_date date not null,
  local_start_time time,
  local_end_time time,
  start_min integer generated always as ((extract(hour from local_start_time) * 60 + extract(minute from local_start_time))::integer) stored,
  end_min integer generated always as ((extract(hour from local_end_time) * 60 + extract(minute from local_end_time))::integer) stored,
  created_at timestamptz not null default now(),
  check ((local_start_time is null) = (local_end_time is null)),
  check (local_start_time is null or local_start_time < local_end_time),
  foreign key (professional_id, organization_id) references public.professionals (id, organization_id) on delete cascade,
  exclude using gist (professional_id with =, local_date with =, int4range(start_min, end_min) with &&) where (start_min is not null)
);
create unique index availability_overrides_closed_uniq on public.availability_overrides (professional_id, local_date) where local_start_time is null;
create index availability_overrides_prof_idx on public.availability_overrides (professional_id, local_date);

-- ======================================================================= clientes
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 120),
  email text check (char_length(email) <= 200 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone text check (char_length(phone) <= 30),
  anonymized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);
create index customers_org_name_idx on public.customers (organization_id, lower(name));
create index customers_org_phone_idx on public.customers (organization_id, phone);

-- ======================================================================= agenda unificada: compromissos e bloqueios disputam o MESMO espaço
-- Intervalo semiaberto [início, fim): reservas adjacentes são permitidas. A exclusão vale só para linhas ativas (cancelar libera o horário).
create table public.schedule_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  professional_id uuid not null,
  kind text not null check (kind in ('appointment', 'block')),
  occupied_start_at timestamptz not null,
  occupied_end_at timestamptz not null,
  active boolean not null default true,
  block_reason text check (char_length(block_reason) <= 200),
  created_by uuid,
  created_at timestamptz not null default now(),
  check (occupied_start_at < occupied_end_at),
  check (kind = 'block' or block_reason is null),
  foreign key (professional_id, organization_id) references public.professionals (id, organization_id),
  unique (id, organization_id),
  unique (id, professional_id, organization_id),
  constraint schedule_entries_no_overlap exclude using gist (
    organization_id with =, professional_id with =, tstzrange(occupied_start_at, occupied_end_at, '[)') with &&
  ) where (active)
);
create index schedule_entries_prof_time_idx on public.schedule_entries (professional_id, occupied_start_at);

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  schedule_entry_id uuid not null unique,
  professional_id uuid not null,
  customer_id uuid not null,
  service_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'confirmed', 'completed', 'no_show', 'cancelled')),
  source text not null check (source in ('admin', 'public')),
  service_name_snapshot text not null,
  duration_minutes_snapshot integer not null check (duration_minutes_snapshot > 0),
  buffer_before_minutes_snapshot integer not null check (buffer_before_minutes_snapshot >= 0),
  buffer_after_minutes_snapshot integer not null check (buffer_after_minutes_snapshot >= 0),
  reference_price_cents_snapshot bigint check (reference_price_cents_snapshot >= 0),
  internal_notes text check (char_length(internal_notes) <= 1000),
  cancellation_reason text check (char_length(cancellation_reason) <= 300),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (starts_at < ends_at),
  foreign key (organization_id) references public.organizations(id) on delete cascade,
  -- adiada: reagendar com troca de profissional atualiza a agenda e o compromisso na mesma transação
  foreign key (schedule_entry_id, professional_id, organization_id) references public.schedule_entries (id, professional_id, organization_id) deferrable initially deferred,
  foreign key (customer_id, organization_id) references public.customers (id, organization_id),
  foreign key (service_id, organization_id) references public.services (id, organization_id),
  foreign key (professional_id, organization_id) references public.professionals (id, organization_id),
  unique (id, organization_id)
);
create index appointments_org_start_idx on public.appointments (organization_id, starts_at);
create index appointments_prof_start_idx on public.appointments (professional_id, starts_at);
create index appointments_customer_idx on public.appointments (customer_id, starts_at desc);
create index appointments_status_idx on public.appointments (organization_id, status, starts_at);

-- Histórico (sem contatos, sem notas internas): quem fez o quê e quando. Só acrescenta.
create table public.appointment_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  appointment_id uuid not null,
  event_type text not null check (event_type in ('created', 'confirmed', 'rescheduled', 'cancelled', 'completed', 'no_show', 'notes_updated', 'link_reissued', 'customer_anonymized')),
  actor_type text not null check (actor_type in ('admin', 'professional', 'customer', 'system')),
  actor_user_id uuid,
  safe_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(safe_metadata) = 'object' and pg_column_size(safe_metadata) <= 2000),
  created_at timestamptz not null default now(),
  foreign key (appointment_id, organization_id) references public.appointments (id, organization_id)
);
create index appointment_events_appt_idx on public.appointment_events (appointment_id, created_at);

-- ======================================================================= link público de gerenciamento (só o HASH do token é guardado)
create table public.booking_management_tokens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  appointment_id uuid not null,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (appointment_id, organization_id) references public.appointments (id, organization_id)
);
create index booking_tokens_appt_idx on public.booking_management_tokens (appointment_id);

-- Idempotência da reserva pública: a mesma chave com o mesmo conteúdo devolve a mesma reserva; conteúdo diferente é recusado.
create table public.public_booking_requests (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  idempotency_key uuid not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  appointment_id uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  primary key (organization_id, idempotency_key),
  foreign key (appointment_id, organization_id) references public.appointments (id, organization_id)
);
create index public_booking_requests_exp_idx on public.public_booking_requests (expires_at);

-- Limite de abuso COMPARTILHADO entre instâncias (vive no banco, não na memória do servidor).
create table public.booking_rate_limits (
  bucket text not null check (char_length(bucket) <= 120),
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (bucket, window_start)
);

commit;
