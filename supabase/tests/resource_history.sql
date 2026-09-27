begin;
set local role service_role;
do $$
declare stamp timestamptz := date_trunc('minute', now()) + interval '1 second';
begin
  delete from public.resource_history where node_name = 'nilavus' and bucket = date_trunc('minute', stamp);
  update public.node_status set received_at = stamp, cpu_percent = 25, memory_percent = 50 where node_name = 'nilavus';
  update public.node_status set received_at = stamp + interval '1 second', cpu_percent = 0, memory_percent = 100 where node_name = 'nilavus';
  if (select count(*) from public.resource_history where node_name = 'nilavus' and bucket = date_trunc('minute', stamp)) <> 1
    or not exists (select 1 from public.resource_history where node_name = 'nilavus' and sampled_at = stamp + interval '1 second' and cpu_percent = 0 and memory_percent = 100) then
    raise exception 'Capture, deduplication or valid endpoints failed';
  end if;
  update public.node_status set received_at = stamp, cpu_percent = 80 where node_name = 'nilavus';
  if exists (select 1 from public.resource_history where node_name = 'nilavus' and bucket = date_trunc('minute', stamp) and cpu_percent <> 0) then
    raise exception 'Older sample replaced newer sample';
  end if;
  update public.node_status set received_at = stamp + interval '2 seconds', cpu_percent = null, memory_percent = 55 where node_name = 'nilavus';
  if not exists (select 1 from public.resource_history where node_name = 'nilavus' and sampled_at = stamp + interval '2 seconds' and cpu_percent is null and memory_percent = 55) then
    raise exception 'Missing CPU incorrectly represented';
  end if;
  insert into public.resource_history values ('nilavus', stamp - interval '31 days', stamp - interval '31 days', 40, 50);
  update public.node_status set received_at = stamp + interval '3 seconds', cpu_percent = null, memory_percent = null where node_name = 'nilavus';
  if exists (select 1 from public.resource_history where bucket < now() - interval '30 days') then raise exception 'Retention failed'; end if;
  if exists (select 1 from public.resource_history where node_name = 'nilavus' and sampled_at = stamp + interval '3 seconds') then raise exception 'Empty sample recorded'; end if;
  if has_table_privilege('anon', 'public.resource_history', 'SELECT') or has_table_privilege('authenticated', 'public.resource_history', 'INSERT') then raise exception 'Direct browser access allowed'; end if;
end;
$$;
rollback;
