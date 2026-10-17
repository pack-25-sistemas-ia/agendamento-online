-- Agendamento Online — LOGOTIPO DA PÁGINA PÚBLICA (Storage). Bucket público (o logotipo é público por natureza), só imagens raster pequenas (sem SVG: evita script embutido).
-- Caminho: <organização>/logo-<hex>.<png|jpg|webp>. Só o proprietário da empresa grava/remove; o navegador nunca vê o caminho (a rota do app serve o arquivo).
-- Só cria o bucket se o Storage existir (Postgres puro de teste não tem).

do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') and exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('ag-logos', 'ag-logos', true, 524288, array['image/png', 'image/jpeg', 'image/webp']) on conflict (id) do nothing;

    execute $p$create policy ag_logos_insert on storage.objects for insert to authenticated with check (
      bucket_id = 'ag-logos' and objects.name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/logo-[0-9a-f]{8,32}\.(png|jpg|webp)$'
      and private.ag_is_owner(split_part(objects.name, '/', 1)::uuid))$p$;
    execute $p$create policy ag_logos_delete on storage.objects for delete to authenticated using (
      bucket_id = 'ag-logos' and objects.name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
      and private.ag_is_owner(split_part(objects.name, '/', 1)::uuid))$p$;
  end if;
end $$;
