begin;
set local role service_role;
do $$
declare stamp timestamptz := date_trunc('minute', now()) + interval '1 second';
begin
  delete from public.disk_history where drive_name = 'Dosimeter' and bucket = date_trunc('minute', stamp);
  update public.node_status set received_at = stamp,
    services = '{"_drives":[{"name":"Dosimeter","online":true,"usedPercent":65}]}'::jsonb where node_name = 'nilavus';
  update public.node_status set received_at = stamp + interval '1 second',
    services = '{"_drives":[{"name":"Dosimeter","online":true,"usedPercent":66}]}'::jsonb where node_name = 'nilavus';
  if (select count(*) from public.disk_history where drive_name = 'Dosimeter' and bucket = date_trunc('minute', stamp)) <> 1
     or not exists (select 1 from public.disk_history where drive_name = 'Dosimeter' and sampled_at = stamp + interval '1 second' and used_percent = 66) then
    raise exception 'Minute capture/upsert failed';
  end if;
  update public.node_status set received_at = stamp + interval '2 seconds',
    services = '{"_drives":[{"name":"Dosimeter","online":false,"usedPercent":1},{"name":"Dosimeter","online":true,"usedPercent":999}]}'::jsonb where node_name = 'nilavus';
  if exists (select 1 from public.disk_history where drive_name = 'Dosimeter' and sampled_at = stamp + interval '2 seconds') then
    raise exception 'Offline/invalid value recorded';
  end if;
  update public.node_status set services = '{"_drives":null}'::jsonb where node_name = 'nilavus';
  insert into public.disk_history values ('Dosimeter', stamp - interval '31 days', stamp - interval '31 days', 40);
  update public.node_status set received_at = stamp where node_name = 'nilavus';
  if exists (select 1 from public.disk_history where bucket < now() - interval '30 days') then raise exception 'Retention failed'; end if;
  if has_table_privilege('anon', 'public.disk_history', 'SELECT') or has_table_privilege('authenticated', 'public.disk_history', 'INSERT') then raise exception 'Direct browser access allowed'; end if;
end;
$$;
rollback;
