begin;
create table public.resource_history (
  node_name text not null check (node_name in ('nilavus', 'nilavus-storage')),
  bucket timestamptz not null,
  sampled_at timestamptz not null,
  cpu_percent real check (cpu_percent between 0 and 100),
  memory_percent real check (memory_percent between 0 and 100),
  primary key (node_name, bucket)
);
create index resource_history_retention_idx on public.resource_history(bucket);
alter table public.resource_history enable row level security;
revoke all on public.resource_history from public, anon, authenticated;
grant select, insert, update, delete on public.resource_history to service_role;
create function public.record_resource_history() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.node_name in ('nilavus', 'nilavus-storage') and
     (new.cpu_percent between 0 and 100 or new.memory_percent between 0 and 100) then
    insert into public.resource_history (node_name, bucket, sampled_at, cpu_percent, memory_percent)
    values (new.node_name, date_trunc('minute', new.received_at), new.received_at,
      case when new.cpu_percent between 0 and 100 then new.cpu_percent end,
      case when new.memory_percent between 0 and 100 then new.memory_percent end)
    on conflict (node_name, bucket) do update set sampled_at = excluded.sampled_at,
      cpu_percent = excluded.cpu_percent, memory_percent = excluded.memory_percent
      where excluded.sampled_at > public.resource_history.sampled_at;
  end if;
  delete from public.resource_history where bucket < now() - interval '30 days';
  return new;
end;
$$;
revoke all on function public.record_resource_history() from public, anon, authenticated;
grant execute on function public.record_resource_history() to service_role;
create trigger node_resource_history after insert or update on public.node_status
for each row execute function public.record_resource_history();
commit;
