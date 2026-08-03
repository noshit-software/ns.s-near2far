# knightsrook-near2far

Self-hosted family location + situational awareness. Private by default. Yours by design.

Part of noshit.software. AGPL-3.0. Domain: near2far.family

## Stack

- **backend/** — FastAPI, event bus, WebSocket stream to dashboard
- **dashboard/** — React+Vite PWA skeleton (map, alerts, trust groups, setup wizard land here)
- **db/** — Postgres 16 + pgvector + Apache AGE

## Quickstart

```bash
cp .env.example .env   # fill in values
docker compose up --build
```

- Dashboard: http://localhost:5101
- API: http://localhost:5100/health

First build compiles Apache AGE from source (needs flex/bison, included in the db Dockerfile) — takes ~3 min.

## Spec

Full product spec lives in the Knightsrook MCP knowledge base (`project:near2far:spec`, `project:near2far:funding`). See also [docs/architecture/overview.md](docs/architecture/overview.md) for the service-level architecture.
