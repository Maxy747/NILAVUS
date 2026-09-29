# PC worker controls

M.A.X.'s DOCKER button checks only the Windows PC's two Immich containers.
It displays status, then asks the configured Tailscale owner whether to start
stopped workers. Typing `start PC workers` is an explicit request and starts them
without another prompt. Background status
polls never start anything. Running workers are not restarted; missing containers
are not created, paused containers are not unpaused, and arbitrary commands are
not accepted. It can start Docker Desktop while the PC is awake and signed in,
but cannot wake a sleeping or powered-off PC.

`pc_workers.py` runs as the Windows Docker Desktop user via the logon task
`NILAVUS PC Worker Bridge`. It binds port 8096 only on the configured Tailscale
address. Requests require both Dosimeter's Tailscale source IP and a random
48-byte token. There is no Docker socket exposed and no public port forwarding.
The Windows config lives under `%LOCALAPPDATA%/NILAVUS/pc-workers.json`, protected
by the user's ACL. The copied bridge script lives alongside it.

`max_docker.py` on Dosimeter reads `~/.config/nilavus-pc-bridge.json` (mode 0600).
Fields: `url`, `token`, and exact Tailscale `owner` login. Never commit these files.
M.A.X. listens only on loopback; its start endpoint accepts only Tailscale Serve's
verified owner identity, a configured frontend Origin, JSON and `{confirm:true}`.
Public Funnel users can read limited status but cannot start workers. Start
requests have a 30-second cooldown; the PC bridge serializes starts. Authentication
does not depend on the AI model. The UI's direct Docker route does not load it.

PC status refreshes every 15 seconds while the console is open; the backend caches
for 10 seconds. Unreachable is not treated as stopped. Container health is not
proof of completed jobs. NAS mounts, database and Redis must still be available.

Disable the Windows scheduled task to disable the bridge. Remove the private
config on Dosimeter to revoke its token. Neither operation deletes containers or
media. Updating the repo script does not update the installed Windows copy: copy
it into the above directory and restart that scheduled task.

Tests: `python -m unittest discover -s agent-v2 -p test_pc_workers.py -v` and
`node scripts/test-docker-ui.mjs <path-to-playwright>` against Vite on port 5173.
