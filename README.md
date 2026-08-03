# knightsrook-near2far

Self-hosted family location + situational awareness. Private by default. Yours by design.

Part of noshit.software. AGPL-3.0. Domain: near2far.family

## Stack

- **backend/** — FastAPI, event bus, WebSocket stream to dashboard, setup API (household + members),
  positions API (`POST /api/positions` to report, `GET /api/positions/latest` for current per-member
  position)
- **dashboard/** — React+Vite PWA. Once a household exists, the live family map is the default view:
  pick which member you are ("Reporting as"), and the browser's own geolocation reports your position
  every ~15s; every member's latest position renders on a shared map, live-updated over the existing
  WebSocket event stream. Real phone GPS via Traccar is a planned follow-up (needs either a same-LAN
  test or deploying to the VPS so the Traccar Client app has a reachable server). A "Settings" button
  opens household/member management (home geofence via a Leaflet map you click to place a pin, member
  list). No address search — Nominatim's free geocoder wasn't reliable enough at house-level precision
  to be worth the confusion. No trust tiers — every member sees every other member's exact location;
  that's the whole point for a family-safety use case. Place alerts are still a placeholder.
- **db/** — Postgres 16 + pgvector + Apache AGE

## Quickstart

```bash
cp .env.example .env   # fill in values
docker compose up --build
```

- Dashboard: http://localhost:5100
- API: http://localhost:5101/health

First build compiles Apache AGE from source (needs flex/bison, included in the db Dockerfile) — takes ~3 min.

## VPS deploy (near2far.family)

Backend + dashboard run natively via pm2/nginx (not Docker), matching the other noshit.software
services on this box. Only Postgres stays containerized (Apache AGE needs a from-source build).

```bash
# on the VPS, in the repo folder (ns.s-bear2far)
cp .env.example .env                    # fill in postgres creds
docker compose up -d --build db         # db only, port published to 127.0.0.1

cd dashboard && npm install && npm run build && cd ..   # produces dashboard/dist

cp backend/.env.example backend/.env    # same postgres creds as root .env
pm2 start ecosystem.config.js
pm2 save

sudo cp deploy/nginx/near2far.family.conf /etc/nginx/sites-available/near2far.conf
sudo ln -s /etc/nginx/sites-available/near2far.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

Cloudflare terminates TLS (DNS already proxied to this box); nginx serves plain HTTP on 80 and
proxies `/api` + `/ws` to the backend on `127.0.0.1:5101`.

## Auth

There's no global API key. Setup creates the household with an admin password, which the dashboard
stores locally and sends as a `Bearer` token. Endpoints besides `/health` and `/api/setup/household`
(GET) and `/api/setup/verify` require it once a household exists.

## Spec

Full product spec lives in the Knightsrook MCP knowledge base (`project:near2far:spec`, `project:near2far:funding`). See also [docs/architecture/overview.md](docs/architecture/overview.md) for the service-level architecture.

Note: the stored spec's trust-tier/redaction concept (intimate/named/ambient) was dropped during
implementation — decided it added complexity without a clear benefit for a family-safety tool, where
knowing someone's exact location is the point. The spec doc hasn't been updated to reflect this yet.
