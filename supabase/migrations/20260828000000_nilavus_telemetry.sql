create table if not exists public.node_status (
  node_name text primary key,
  received_at timestamptz not null default now(),
  temperature_c real,
  cpu_percent real,
  memory_percent real,
  disk_percent real,
  uptime_seconds bigint,
  load real[] not null default '{}',
  services jsonb not null default '{}'::jsonb,
  constraint node_status_known_node check (node_name in ('nilavus', 'nilavus-storage')),
  constraint node_status_cpu_range check (cpu_percent is null or cpu_percent between 0 and 100),
  constraint node_status_memory_range check (memory_percent is null or memory_percent between 0 and 100),
  constraint node_status_disk_range check (disk_percent is null or disk_percent between 0 and 100),
  constraint node_status_uptime_nonnegative check (uptime_seconds is null or uptime_seconds >= 0)
);

create table if not exists public.daily_visitors (
  visit_date date not null,
  visitor_hash text not null,
  first_seen_at timestamptz not null default now(),
  primary key (visit_date, visitor_hash)
);

alter table public.node_status enable row level security;
alter table public.daily_visitors enable row level security;

revoke all on public.node_status from anon, authenticated;
revoke all on public.daily_visitors from anon, authenticated;

comment on table public.node_status is 'Latest heartbeat for each NILAVUS host; accessed only through Edge Functions.';
comment on table public.daily_visitors is 'Daily privacy-preserving unique visitor hashes; raw IP addresses are never stored.';
