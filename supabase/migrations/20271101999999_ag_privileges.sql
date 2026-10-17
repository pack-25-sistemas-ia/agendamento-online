-- Agendamento Online — PRIVILÉGIOS DAS FUNÇÕES (última migração do sistema).
-- O Postgres concede EXECUTE a PUBLIC por padrão e o Supabase a anon/authenticated. Aqui:
--  · administrativas (public.ag_*): só usuário autenticado (cada uma ainda valida sessão, MFA e perfil);
--  · operações públicas (public.ag_public_*): também anon — e só elas;
--  · internas (private.ag_*): ninguém, exceto os auxiliares que as políticas de RLS e o painel (SECURITY INVOKER) avaliam como o próprio usuário.

begin;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'ag\_%' loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
    if f.proname like 'ag\_public\_%' then
      execute format('grant execute on function %s to anon', f.sig);
      -- marca exigida pelo teste do Core (20_profiles.sql): toda função SECURITY DEFINER executável por anon é uma porta pública DECLARADA.
      execute format('comment on function %s is %L', f.sig, 'PUBLIC_ENDPOINT: operação pública de agendamento (sem sessão). Valida entradas, aplica limite de abuso no banco e devolve só o mínimo necessário. Ver docs/SECURITY.md.');
    end if;
  end loop;
  for f in select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname like 'ag\_%' loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    if f.proname in ('ag_role', 'ag_my_professional', 'ag_profile', 'ag_is_owner', 'ag_is_manager', 'ag_customer_visible', 'ag_appt_visible', 'ag_guard', 'ag_tz', 'ag_today') then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
end $$;

commit;
