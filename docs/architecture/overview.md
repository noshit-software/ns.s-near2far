# knightsrook-near2far — Architecture Overview

## Purpose

Self-hosted family location + situational awareness. Private by default, self-hosted, AGPL-3.0.
Replaces Life360's core value (family location, place alerts, trip history) with a stack whose
data never leaves the household's own server. Full product spec lives in the Knightsrook MCP
knowledge base (`project:near2far:spec`, `project:near2far:funding`).

## Services

| Service   | Tech                          | Port (host) | Responsibility |
|-----------|--------------------------------|--------------|----------------|
| backend   | FastAPI + asyncpg              | 5100         | REST API, event bus, WebSocket stream to dashboard |
| dashboard | React+Vite PWA                 | 5101         | Family map, setup wizard, trust-group UI |
| db        | Postgres 16 + pgvector + AGE   | (internal)   | Substrate/runtime data, graph relationships for trust tiers |

## Data Model

Two schemas in Postgres:
- `substrate` — persistent reference data (households, members, trust tiers). Survives `db:reset`.
- `runtime` — ephemeral working state (live positions). Dropped/recreated by `db:reset`.

Apache AGE is available for graph-based trust-tier and correlation modeling as the product grows
into the `far → near` community-signal correlator described in the spec.

## Key Flows

1. **Position ingest** — Traccar Client (external) reports position → backend writes to
   `runtime.positions` → backend publishes a `position.updated` event → dashboard WebSocket
   clients receive it live.
2. **Health check** — dashboard polls `/health` on load; backend reports DB connectivity.
3. **Trust-tier redaction** (not yet implemented) — position/data hydration will filter through
   `substrate.members.trust_tier` before reaching the API response.

## Architecture Decision Records

### ADR-001 — FastAPI + React/Vite PWA over single-app scaffold
**Status:** Accepted
**Context:** The near2far spec calls for a modular, multi-service system (traccar, postgres,
redis, calendar-sync, notification-router, PWA) — not a single frontend/backend unit.
**Decision:** Scaffold as multi-service: FastAPI backend, React+Vite dashboard (serving as the
PWA shell), Postgres with pgvector+AGE.
**Consequences:** Dashboard scaffold started from the internal-tool template and was stripped
down to a PWA shell (manifest, service worker, map/wizard placeholders) rather than kept as a
dev-tool UI. Real map, wizard, and trust-group UI are still TODO.

### ADR-002 — Adjacent ports instead of range-spread defaults
**Status:** Accepted
**Context:** Scaffold-anything's default port ranges (FastAPI 5100-5199, Vite dev 5300-5399)
would have put backend and dashboard far apart.
**Decision:** Use adjacent ports instead: backend 5100, dashboard 5101. Confirmed clean via a
full grep of both `workspace-knightsrook` and `workspace-ns.s`, excluding `node_modules`/`dist`.
**Consequences:** Deviates from the scaffold tool's per-category range convention for this
project only. Recorded in `project:knightsrook:port-registry` (MCP) to prevent future collision.
