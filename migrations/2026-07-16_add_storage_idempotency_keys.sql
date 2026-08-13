-- Apply before deploying the code that references request_id/source_ref.
-- The application schema is configured through DB_SCHEMA, so discover the
-- single non-system schema that owns quotes instead of assuming public.

do $migration$
declare
  quotes_schema text;
  quotes_table_count integer;
begin
  select min(table_schema), count(*)
    into quotes_schema, quotes_table_count
    from information_schema.tables
   where table_name = 'quotes'
     and table_type = 'BASE TABLE'
     and table_schema not in ('pg_catalog', 'information_schema');

  if quotes_table_count = 0 then
    raise exception 'quotes table was not found in any application schema';
  elsif quotes_table_count > 1 then
    raise exception 'quotes table exists in multiple schemas; set the target schema explicitly';
  end if;

  execute format(
    'alter table %I.quotes add column if not exists request_id text',
    quotes_schema
  );
  execute format(
    'create unique index if not exists quotes_request_id_unique on %I.quotes (request_id)',
    quotes_schema
  );
end
$migration$;

-- customer.install is an optional integration table and is not present in
-- every deployment. Apply its idempotency key only where that integration
-- has been provisioned.
do $migration$
begin
  if to_regclass('customer.install') is null then
    raise notice 'customer.install was not found; skipping source_ref migration';
    return;
  end if;

  execute 'alter table customer.install add column if not exists source_ref text';
  execute 'create unique index if not exists install_source_ref_unique on customer.install (source_ref)';
end
$migration$;
