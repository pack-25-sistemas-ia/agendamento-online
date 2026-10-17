-- Agendamento Online — MOTOR DE HORÁRIOS (fonte de verdade da disponibilidade) e proteção contra corrida.
-- Regras: janelas semanais em HORA LOCAL da empresa; exceção por data SUBSTITUI o dia; bloqueios e reservas ativas são subtraídos;
-- a ocupação [início − buffer anterior, fim + buffer posterior) precisa caber inteira na janela; passo configurável só define a grade de inícios.
-- Hora local inexistente (salto do horário de verão) → deslocada para frente (offset anterior à mudança); ambígua (volta) → ocorrência POSTERIOR.
-- É o comportamento nativo do Postgres, documentado em docs/DECISIONS.md e espelhado/testado em lib/scheduling/time.ts.

begin;
set local check_function_bodies = off;

-- Mensagens ao usuário (nenhum termo técnico). O código 23P01 sinaliza «horário tomado» para a interface recarregar as opções.
create function private.ag_friendly(code text) returns text language sql immutable set search_path = '' as $$
  select case code
    when 'past' then 'Esse horário já passou. Escolha outro horário.'
    when 'notice' then 'Esse horário exige mais antecedência. Escolha um horário mais à frente.'
    when 'horizon' then 'Esse horário está além do período aberto para reservas.'
    when 'outside' then 'Esse horário não está disponível para este profissional.'
    when 'conflict' then 'Esse horário acabou de ser reservado. Escolha outro horário.'
    when 'service' then 'Este serviço não está disponível.'
    when 'professional' then 'Este profissional não está disponível.'
    when 'association' then 'Este profissional não realiza o serviço escolhido.'
    else 'Horário indisponível.' end;
$$;

-- Serializa quem mexe na agenda de um profissional (reserva, remarcação, bloqueio, mudança de disponibilidade).
create function private.ag_lock(p_prof uuid) returns void language sql security definer set search_path = '' as $$
  select pg_advisory_xact_lock(hashtextextended('ag:prof:' || p_prof::text, 11));
$$;

-- Limite de abuso compartilhado (no banco). Ao estourar, a transação é desfeita e a contagem permanece no teto até a janela virar.
create function private.ag_rate_hit(p_bucket text, p_max integer, p_window_seconds integer) returns void
language plpgsql security definer set search_path = '' as $$
declare w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds); h integer;
begin
  insert into public.booking_rate_limits as r (bucket, window_start, hits) values (left(p_bucket, 120), w, 1)
  on conflict (bucket, window_start) do update set hits = r.hits + 1 returning hits into h;
  if h > p_max then raise exception 'Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente de novo.' using errcode = '54000'; end if;
  if random() < 0.02 then
    delete from public.booking_rate_limits where window_start < now() - interval '2 days';
    delete from public.public_booking_requests where expires_at < now();
  end if;
end $$;

-- Janelas de atendimento de um dia local: a exceção da data substitui a regra semanal (dia fechado = nenhuma janela).
create function private.ag_windows(p_prof uuid, p_date date, p_tz text) returns table (w_start timestamptz, w_end timestamptz)
language sql stable security definer set search_path = '' as $$
  select (p_date + o.local_start_time) at time zone p_tz, (p_date + o.local_end_time) at time zone p_tz
  from public.availability_overrides o
  where o.professional_id = p_prof and o.local_date = p_date and o.local_start_time is not null
  union all
  select (p_date + r.local_start_time) at time zone p_tz, (p_date + r.local_end_time) at time zone p_tz
  from public.availability_rules r
  where r.professional_id = p_prof and r.active and r.weekday = extract(dow from p_date)::integer
    and not exists (select 1 from public.availability_overrides o where o.professional_id = p_prof and o.local_date = p_date);
$$;

-- Valida UM horário de início. Devolve NULL se puder ser reservado ou o código do motivo. É a validação oficial do servidor (a interface é indicativa).
--  p_public: aplica antecedência mínima, horizonte e a grade de inícios (só reservas públicas).
--  p_existing: remarcação de compromisso existente — mantém duração/intervalos do momento da reserva e aceita serviço hoje desativado.
create function private.ag_check_slot(p_org uuid, p_prof uuid, p_svc uuid, p_start timestamptz, p_public boolean, p_ignore_entry uuid default null,
  p_duration integer default null, p_buf_before integer default null, p_buf_after integer default null, p_existing boolean default false) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  st public.scheduling_settings; sv public.services; tz text; dur integer; bb integer; ba integer;
  occ_s timestamptz; occ_e timestamptz; w record; ok boolean := false; hz timestamptz;
begin
  select * into st from public.scheduling_settings where organization_id = p_org;
  select * into sv from public.services where id = p_svc and organization_id = p_org;
  if not found or (not sv.active and not p_existing) then return 'service'; end if;
  if not exists (select 1 from public.professionals where id = p_prof and organization_id = p_org and active) then return 'professional'; end if;
  if not exists (select 1 from public.professional_services where professional_id = p_prof and service_id = p_svc) then return 'association'; end if;
  tz := coalesce(st.timezone, 'America/Sao_Paulo');
  dur := coalesce(p_duration, sv.duration_minutes); bb := coalesce(p_buf_before, sv.buffer_before_minutes); ba := coalesce(p_buf_after, sv.buffer_after_minutes);
  if p_start <= now() then return 'past'; end if;
  if p_public then
    if p_start < now() + make_interval(mins => st.minimum_notice_minutes) then return 'notice'; end if;
    hz := (((now() at time zone tz)::date + st.booking_horizon_days + 1)::timestamp) at time zone tz;
    if p_start >= hz then return 'horizon'; end if;
  end if;
  occ_s := p_start - make_interval(mins => bb);
  occ_e := p_start + make_interval(mins => dur + ba);
  for w in select * from private.ag_windows(p_prof, (p_start at time zone tz)::date, tz) loop
    if w.w_start <= occ_s and occ_e <= w.w_end
       and (not p_public or mod((extract(epoch from (p_start - w.w_start)) / 60)::bigint, st.slot_step_minutes) = 0) then
      ok := true; exit;
    end if;
  end loop;
  if not ok then return 'outside'; end if;
  if exists (select 1 from public.schedule_entries e
             where e.professional_id = p_prof and e.active and (p_ignore_entry is null or e.id <> p_ignore_entry)
               and tstzrange(e.occupied_start_at, e.occupied_end_at, '[)') && tstzrange(occ_s, occ_e, '[)')) then
    return 'conflict';
  end if;
  return null;
end $$;

-- Horários livres de um serviço com um profissional, por dia local. Público: com antecedência, horizonte e grade; administrativo: qualquer minuto livre da janela na grade.
create function private.ag_list_slots(p_org uuid, p_prof uuid, p_svc uuid, p_from date, p_to date, p_public boolean,
  p_duration integer default null, p_buf_before integer default null, p_buf_after integer default null, p_ignore_entry uuid default null)
returns table (local_date date, starts_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare
  st public.scheduling_settings; sv public.services; tz text; dur integer; bb integer; ba integer; d date; w record; k integer; s timestamptz; hz timestamptz;
begin
  select * into st from public.scheduling_settings where organization_id = p_org;
  select * into sv from public.services where id = p_svc and organization_id = p_org;
  if not found or (p_duration is null and not sv.active) then return; end if;
  if not exists (select 1 from public.professionals where id = p_prof and organization_id = p_org and active) then return; end if;
  if not exists (select 1 from public.professional_services where professional_id = p_prof and service_id = p_svc) then return; end if;
  tz := coalesce(st.timezone, 'America/Sao_Paulo');
  dur := coalesce(p_duration, sv.duration_minutes); bb := coalesce(p_buf_before, sv.buffer_before_minutes); ba := coalesce(p_buf_after, sv.buffer_after_minutes);
  if p_to < p_from then return; end if;
  if p_to - p_from > 62 then p_to := p_from + 62; end if;
  hz := (((now() at time zone tz)::date + st.booking_horizon_days + 1)::timestamp) at time zone tz;
  for d in select g::date from generate_series(p_from, p_to, interval '1 day') g loop
    for w in select * from private.ag_windows(p_prof, d, tz) order by w_start loop
      for k in 0 .. floor(extract(epoch from (w.w_end - w.w_start)) / 60 / st.slot_step_minutes)::integer loop
        s := w.w_start + make_interval(mins => k * st.slot_step_minutes);
        continue when s - make_interval(mins => bb) < w.w_start;
        exit when s + make_interval(mins => dur + ba) > w.w_end;
        continue when s <= now();
        if p_public then
          continue when s < now() + make_interval(mins => st.minimum_notice_minutes);
          continue when s >= hz;
        end if;
        continue when exists (select 1 from public.schedule_entries e
          where e.professional_id = p_prof and e.active and (p_ignore_entry is null or e.id <> p_ignore_entry)
            and tstzrange(e.occupied_start_at, e.occupied_end_at, '[)') && tstzrange(s - make_interval(mins => bb), s + make_interval(mins => dur + ba), '[)'));
        local_date := d; starts_at := s; return next;
      end loop;
    end loop;
  end loop;
end $$;

revoke all on function private.ag_friendly(text), private.ag_lock(uuid), private.ag_rate_hit(text, integer, integer), private.ag_windows(uuid, date, text),
  private.ag_check_slot(uuid, uuid, uuid, timestamptz, boolean, uuid, integer, integer, integer, boolean),
  private.ag_list_slots(uuid, uuid, uuid, date, date, boolean, integer, integer, integer, uuid) from public, anon, authenticated;

commit;
