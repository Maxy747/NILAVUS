-- One last-known reading per minute, retained for 30 days. No browser dependency.
create table public.temperature_history (
  node_name text not null check (node_name in ('nilavus', 'nilavus-storage')),
  bucket timestamptz not null,
  sampled_at timestamptz not null,
  temperature_c real not null check (temperature_c between -40 and 150),
  primary key (node_name, bucket)
);
create index temperature_history_retention_idx on public.temperature_history (bucket);
alter table public.temperature_history enable row level security;
revoke all on public.temperature_history from public, anon, authenticated;
grant select, insert, update, delete on public.temperature_history to service_role;

create function public.record_temperature() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.temperature_c between -40 and 150 then
    insert into public.temperature_history (node_name, bucket, sampled_at, temperature_c)
    values (new.node_name, date_trunc('minute', new.received_at), new.received_at, new.temperature_c)
    on conflict (node_name, bucket) do update
      set sampled_at = excluded.sampled_at, temperature_c = excluded.temperature_c
      where excluded.sampled_at > public.temperature_history.sampled_at;
  end if;
  delete from public.temperature_history where bucket < now() - interval '30 days';
  return new;
end;
$$;
revoke all on function public.record_temperature() from public, anon, authenticated;
grant execute on function public.record_temperature() to service_role;
create trigger node_temperature_history after insert or update on public.node_status
for each row execute function public.record_temperature();
