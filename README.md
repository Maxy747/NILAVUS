# NILAVUS

Always-online NILAVUS dashboard hosted by GitHub Pages, with status and visitor telemetry stored through Supabase Edge Functions.

## Architecture

- GitHub Pages serves the static dashboard.
- `nilavus` and `nilavus-storage` push a heartbeat every 30 seconds.
- Supabase marks a node offline after 90 seconds without a heartbeat.
- The visitor endpoint stores a daily salted hash; raw IP addresses are not stored.
- No service-role key or telemetry secret is included in the browser bundle or repository.

## Required hosted configuration

1. Apply the Supabase migration in `supabase/migrations`.
2. Deploy the three functions in `supabase/functions`.
3. Set Supabase secrets `TELEMETRY_SECRET` and `VISITOR_PEPPER`.
4. Add the GitHub repository variable `VITE_SUPABASE_FUNCTIONS_URL`.
5. Install the telemetry timer from `agent/` on both hosts.

The existing Tailscale-hosted dashboard can remain active as a fallback during rollout.
