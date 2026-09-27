begin;
create table public.smart_history (
  drive_name text not null check (drive_name in ('Dosimeter', 'NASig', 'WD 1 TB', 'Bookussy')),
  sampled_at timestamptz not null,
  power_on_hours integer not null check (power_on_hours between 0 and 1000000),
  primary key(drive_name, sampled_at)
);
create index smart_history_retention_idx on public.smart_history(sampled_at);
alter table public.smart_history enable row level security;
revoke all on public.smart_history from public, anon, authenticated;
grant select, insert, update, delete on public.smart_history to service_role;
create function public.record_smart_history() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare drive jsonb; label text; hours numeric; epoch numeric;
begin
  if jsonb_typeof(new.services->'_drives') = 'array' then
    for drive in select value from jsonb_array_elements(new.services->'_drives') loop
      label := drive->>'name';
      if ((new.node_name = 'nilavus' and label = 'Dosimeter') or
          (new.node_name = 'nilavus-storage' and label in ('NASig', 'WD 1 TB', 'Bookussy')))
        and drive->'online' = 'true'::jsonb and jsonb_typeof(drive->'powerOnHours') = 'number'
        and jsonb_typeof(drive->'powerOnSampledEpoch') = 'number' then
        hours := (drive->>'powerOnHours')::numeric;
        epoch := (drive->>'powerOnSampledEpoch')::numeric;
        if hours between 0 and 1000000 and hours = trunc(hours)
          and epoch between extract(epoch from now()) - 3600 and extract(epoch from now()) + 60 then
          insert into public.smart_history values (label, to_timestamp(epoch::double precision), hours::integer)
            on conflict do nothing;
        end if;
      end if;
    end loop;
  end if;
  delete from public.smart_history where sampled_at < now() - interval '30 days';
  return new;
end;
$$;
revoke all on function public.record_smart_history() from public, anon, authenticated;
grant execute on function public.record_smart_history() to service_role;
create trigger node_smart_history after insert or update on public.node_status
for each row execute function public.record_smart_history();
commit;
