begin;
set local role service_role;
do $$
declare stamp bigint := floor(extract(epoch from now())); count_before bigint;
begin
  delete from public.smart_history where drive_name = 'Dosimeter' and sampled_at = to_timestamp(stamp);
  update public.node_status set services = jsonb_build_object('_drives', jsonb_build_array(jsonb_build_object(
    'name', 'Dosimeter', 'online', true, 'powerOnHours', 123, 'powerOnSampledEpoch', stamp))) where node_name = 'nilavus';
  update public.node_status set received_at = now() where node_name = 'nilavus';
  if (select count(*) from public.smart_history where drive_name = 'Dosimeter' and sampled_at = to_timestamp(stamp) and power_on_hours = 123) <> 1 then
    raise exception 'SMART capture or cached sample deduplication failed';
  end if;
  select count(*) into count_before from public.smart_history where drive_name = 'Dosimeter';
  update public.node_status set services = jsonb_build_object('_drives', jsonb_build_array(jsonb_build_object(
    'name', 'Dosimeter', 'online', true, 'powerOnHours', 123, 'powerOnSampledEpoch', stamp - 7200))) where node_name = 'nilavus';
  if (select count(*) from public.smart_history where drive_name = 'Dosimeter') <> count_before then raise exception 'Stale sample accepted'; end if;
  if has_table_privilege('anon', 'public.smart_history', 'SELECT') or has_table_privilege('authenticated', 'public.smart_history', 'INSERT') then raise exception 'Direct access allowed'; end if;
end;
$$;
rollback;
