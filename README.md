# knightsrook-near2far

Self-hosted family location + situational awareness. Private by default. Yours by design.

Part of noshit.software. AGPL-3.0. Domain: near2far.family

## Stack

- **backend/** — FastAPI, event bus, WebSocket stream to dashboard, setup API (household + members),
  `GET /api/positions/latest` for current per-member position, and `POST /api/traccar/forward` —
  receives Traccar's position-forwarding webhook and maps it to a member via the source-agnostic
  `device_id` column (not Traccar-specific — other position sources, e.g. Overland, could key off the
  same field later).
- **dashboard/** — React+Vite PWA. Once a household exists, the live family map is the default view:
  every member's latest reported position (currently via Traccar/real phone GPS) renders on a shared
  map, live-updated over the existing WebSocket event stream, with a row of "snap to" buttons below
  the map to quickly center on any member. A "Settings" button opens household/member management (home
  geofence via a Leaflet map you click to place a pin, member list, per-member device linking). No
  address search — Nominatim's free geocoder wasn't reliable enough at house-level precision to be
  worth the confusion. No trust tiers — every member sees every other member's exact location; that's
  the whole point for a family-safety use case. Place alerts are still a placeholder.
- **db/** — Postgres 16 + pgvector + Apache AGE
- **traccar** — official `traccar/traccar` image, own embedded database (unrelated to the Postgres
  above). Web UI + REST API on :8082 (localhost-only — reach it via an nginx-proxied subdomain, e.g.
  `traccar.near2far.family`, not directly), OsmAnd protocol (used by the Traccar Client phone app) on
  :5055 (exposed publicly — phones need to reach it directly). Configured to forward every position to
  the backend via `TRACCAR_FORWARD_URL`.

## Quickstart

```bash
cp .env.example .env   # fill in values
docker compose up --build
```

- Dashboard: http://localhost:5100
- API: http://localhost:5101/health

First build compiles Apache AGE from source (needs flex/bison, included in the db Dockerfile) — takes ~3 min.

## Traccar (real phone GPS)

The web UI (:8082) is bound to `127.0.0.1` in `docker-compose.yml`, not exposed publicly — reach it
through an nginx-proxied subdomain instead (e.g. `traccar.near2far.family`, same pattern as
`near2far.family` itself: an nginx site block proxying to `127.0.0.1:8082`, plus a Cloudflare DNS
record for that subdomain).

1. Open the Traccar web UI at `https://traccar.near2far.family` (first visit lets you create the admin
   account).
2. For each family member, create a device (Settings → Devices → Add) with any identifier you want
   (e.g. `alex-phone`).
3. Install the **Traccar Client** app on that member's phone, set the identifier to match, and set the
   server URL to `http://<server>:5055` (this port stays exposed directly — phones talk to it, not
   through nginx/Cloudflare).
4. In near2far's dashboard Settings, paste that same identifier into the member's "Device ID" field
   and Save.

From then on, Traccar forwards every position update to the backend (`TRACCAR_FORWARD_URL`, see
`.env.example`), which maps it to that member and pushes it to the family map over the same WebSocket
stream the browser-geolocation reporting uses — both sources land in the same place.

`TRACCAR_FORWARD_URL` differs by deployment:
- Local all-in-one docker-compose dev: `http://backend:8000/api/traccar/forward`
- VPS (backend runs via pm2, not in this compose file): `http://host.docker.internal:5101/api/traccar/forward`

### VPS deploy gotchas (learned the hard way)

- **`git pull` alone does nothing for the running backend.** `pm2` doesn't hot-reload — after
  pulling backend changes, you must `pm2 restart near2far` or the old code keeps running silently
  (symptom: a route that clearly exists in the code 404s with FastAPI's generic `{"detail":"Not
  Found"}`, meaning the route was never actually registered in the running process).
- **`git pull` also doesn't rebuild the dashboard.** It only updates source files; nginx serves the
  compiled `dashboard/dist/`, which only regenerates via an explicit `npm run build`.
- **`ufw` needs an explicit rule for every port containers need to reach on the host**, not just
  public-facing ones. The backend (port 5101, host-run via pm2) needs to be reachable from Docker's
  bridge networks for the traccar container's `TRACCAR_FORWARD_URL` to work —
  `sudo ufw allow from 172.16.0.0/12 to any port 5101 proto tcp` (covers Docker's typical bridge
  subnets without opening the port publicly).
- **`db/init/*.sql` only runs once**, when a Postgres volume is first created. Schema changes added
  after that need a manual `ALTER TABLE`/`docker compose down -v` — a plain `git pull` doesn't apply
  them to an already-running database.
- **A browser's "This page isn't working" screen isn't necessarily a connectivity failure** — check
  for a specific HTTP status code in the error page (e.g. "HTTP ERROR 400") before assuming DNS/
  firewall/network issues; that generic wrapper renders for any 4xx/5xx response with an empty body.

## Auth

There's no global API key. Setup creates the household with an admin password, which the dashboard
stores locally and sends as a `Bearer` token. Endpoints besides `/health` and `/api/setup/household`
(GET) and `/api/setup/verify` require it once a household exists.

## Spec

Full product spec lives in the Knightsrook MCP knowledge base (`project:near2far:spec`, `project:near2far:funding`). See also [docs/architecture/overview.md](docs/architecture/overview.md) for the service-level architecture.

Note: the stored spec's trust-tier/redaction concept (intimate/named/ambient) was dropped during
implementation — decided it added complexity without a clear benefit for a family-safety tool, where
knowing someone's exact location is the point. The spec doc hasn't been updated to reflect this yet.
