# knightsrook-near2far

Self-hosted family location + situational awareness. Private by default. Yours by design.

Part of noshit.software. AGPL-3.0. Domain: near2far.family

## Stack

- **backend/** — FastAPI, event bus, WebSocket stream to dashboard, setup API (household + members)
- **dashboard/** — React+Vite PWA. Once a household exists, the map is the default view, with a
  "Settings" button that opens household/member management (home geofence via a Leaflet map you
  click to place a pin, member list). No address search — Nominatim's free geocoder wasn't reliable
  enough at house-level precision to be worth the confusion. No trust tiers — every member sees
  every other member's exact location; that's the whole point for a family-safety use case. Place
  alerts and the live family map itself (positions) are still placeholders.
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

Note: the stored spec's trust-tier/redaction concept (intimate/named/ambient) was dropped during
implementation — decided it added complexity without a clear benefit for a family-safety tool, where
knowing someone's exact location is the point. The spec doc hasn't been updated to reflect this yet.
