# Temperature history

## Disk history

`20260927171000_disk_history.sql` adds independently saved one-minute drive usage
readings (30-day retention). Only online, valid telemetry from each drive's owner
is captured; no historical backfill. The read-only `disk-history` function exposes
the last 24 hours for Dosimeter, NASig, WD 1 TB and Bookussy. RLS prevents direct
browser reads/writes. Run `supabase/tests/disk_history.sql` for rolled-back tests.
M.A.X.'s sidebar selector switches between temperature and disk usage; holding
the storage card reveals the disk graph. Gaps and stale samples stay visible.

The `node_status` trigger saves the latest valid temperature in each UTC minute,
independently of browser activity. Both the normal and relay heartbeat paths are
covered. No historical temperatures are fabricated or backfilled. Old samples
are pruned after 30 days when a heartbeat arrives.

The read-only `temperature-history` Edge Function exposes only the last 24 hours
for the two known hosts. It reads two pages per host to avoid the REST row limit.
The underlying table has RLS and no browser-role permissions. No client secrets.

Health cards reveal the chart above their Easter egg while held (pointer or
Space/Enter). M.A.X. uses the same chart in its sidebar, with both hosts. Visible
graphs refresh every 10 seconds; missing periods over three minutes are gaps.
This is sampled history, not a record of every instantaneous temperature spike.

Deploy the migration before the Edge Function and frontend. Run
`supabase/tests/temperature_history.sql` to check capture, deduplication, retention,
and permissions inside a rolled-back transaction. UI regression checks are in
`scripts/test-temperature-ui.mjs`; they use mocked history, not production writes.
