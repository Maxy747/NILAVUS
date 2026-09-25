-- Regression checks; always rolled back, including simulated telemetry.
begin;
set local role service_role;
do $$
declare before_count integer; after_count integer;
begin
  update public.node_status set received_at = now(), temperature_c = 51 where node_name = 'nilavus';
  select count(*) into before_count from public.temperature_history where node_name = 'nilavus';
  update public.node_status set temperature_c = 52 where node_name = 'nilavus';
  select count(*) into after_count from public.temperature_history where node_name = 'nilavus';
  if before_count <> after_count then raise exception 'Duplicate minute inserted'; end if;
  if not exists (select 1 from public.temperature_history where node_name = 'nilavus' and bucket = date_trunc('minute', now())) then
    raise exception 'Heartbeat did not record history';
  end if;
  insert into public.temperature_history values ('nilavus', now() - interval '31 days', now() - interval '31 days', 40);
  update public.node_status set received_at = now(), temperature_c = null where node_name = 'nilavus-storage';
  if exists (select 1 from public.temperature_history where bucket < now() - interval '30 days') then
    raise exception 'Retention failed';
  end if;
  if has_table_privilege('anon', 'public.temperature_history', 'SELECT') or has_table_privilege('anon', 'public.temperature_history', 'INSERT') then
    raise exception 'History directly exposed to anon';
  end if;
end;
$$;
rollback;
