# knightsrook-near2far

Self-hosted family location + situational awareness. Private by default. Yours by design.

Part of noshit.software. AGPL-3.0. Domain: near2far.family

## Stack

- **backend/** — FastAPI, event bus, WebSocket stream to dashboard, setup API (household + members)
- **dashboard/** — React+Vite PWA. Once a household exists, the map is the default view, with a
  "Settings" button that opens household/member management (home geofence via a Leaflet picker with
  Nominatim address search, member list, trust tiers). Place alerts and the live family map itself
  (positions, redaction) are still placeholders.
- **db/** — Postgres 16 + pgvector + Apache AGE

## Quickstart

```bash
cp .env.example .env   # fill in values
docker compose up --build
```

- Dashboard: http://localhost:5100
- API: http://localhost:5101/health

First build compiles Apache AGE from source (needs flex/bison, included in the db Dockerfile) — takes ~3 min.

## Auth

There's no global API key. Setup creates the household with an admin password, which the dashboard
stores locally and sends as a `Bearer` token. Endpoints besides `/health` and `/api/setup/household`
(GET) and `/api/setup/verify` require it once a household exists.

## Spec

Full product spec lives in the Knightsrook MCP knowledge base (`project:near2far:spec`, `project:near2far:funding`). See also [docs/architecture/overview.md](docs/architecture/overview.md) for the service-level architecture.
