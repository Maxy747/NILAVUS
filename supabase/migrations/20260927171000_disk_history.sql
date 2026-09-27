begin;
create table public.disk_history (
  drive_name text not null check (drive_name in ('Dosimeter', 'NASig', 'WD 1 TB', 'Bookussy')),
  bucket timestamptz not null,
  sampled_at timestamptz not null,
  used_percent real not null check (used_percent between 0 and 100),
  primary key (drive_name, bucket)
);
create index disk_history_retention_idx on public.disk_history (bucket);
alter table public.disk_history enable row level security;
revoke all on public.disk_history from public, anon, authenticated;
grant select, insert, update, delete on public.disk_history to service_role;

create function public.record_disk_history() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare drive jsonb; label text; usage real;
begin
  if jsonb_typeof(new.services->'_drives') = 'array' then
    for drive in select value from jsonb_array_elements(new.services->'_drives') loop
      label := drive->>'name';
      if ((new.node_name = 'nilavus' and label = 'Dosimeter') or
          (new.node_name = 'nilavus-storage' and label in ('NASig', 'WD 1 TB', 'Bookussy')))
         and drive->'online' = 'true'::jsonb
         and jsonb_typeof(drive->'usedPercent') = 'number' then
        -- Validate as numeric before converting to real to avoid overflow.
        if (drive->>'usedPercent')::numeric between 0 and 100 then
          usage := (drive->>'usedPercent')::real;
          insert into public.disk_history (drive_name, bucket, sampled_at, used_percent)
          values (label, date_trunc('minute', new.received_at), new.received_at, usage)
          on conflict (drive_name, bucket) do update
            set sampled_at = excluded.sampled_at, used_percent = excluded.used_percent
            where excluded.sampled_at > public.disk_history.sampled_at;
        end if;
      end if;
    end loop;
  end if;
  delete from public.disk_history where bucket < now() - interval '30 days';
  return new;
end;
$$;
revoke all on function public.record_disk_history() from public, anon, authenticated;
grant execute on function public.record_disk_history() to service_role;
create trigger node_disk_history after insert or update on public.node_status
for each row execute function public.record_disk_history();
commit;
