# knightsrook-near2far — Architecture Overview

## Purpose

Self-hosted family location + situational awareness. Private by default, self-hosted, AGPL-3.0.
Replaces Life360's core value (family location, place alerts, trip history) with a stack whose
data never leaves the household's own server. Full product spec lives in the Knightsrook MCP
knowledge base (`project:near2far:spec`, `project:near2far:funding`).

## Services

| Service   | Tech                          | Port (host) | Responsibility |
|-----------|--------------------------------|--------------|----------------|
| backend   | FastAPI + asyncpg              | 5101         | REST API, event bus, WebSocket stream to dashboard, GPS ingestion (Traccar/Overland/OwnTracks), trip detection, Web Push |
| dashboard | React+Vite PWA                 | 5100         | Live family map, setup wizard, member management |
| db        | Postgres 16 + pgvector + AGE   | (internal)   | Substrate/runtime data. pgvector/AGE are provisioned but not yet used by any current feature |
| traccar   | traccar/traccar (pinned)       | 8082 (localhost only), 5055 | Android GPS ingestion + forwarding to backend |

## Data Model

Two schemas in Postgres:
- `substrate` — persistent reference data (households, members: name, avatar, color, device_id).
  Survives `db:reset`.
- `runtime` — ephemeral working state (positions, push subscriptions). Dropped/recreated by
  `db:reset`.

There is no trust-tier/redaction system — an earlier draft of the spec had one, dropped during
implementation. Every household member sees every other member's exact location; that's the
point of a family-safety tool. See README's "Editing a member" / spec revision notes for detail.

## Key Flows

1. **Position ingest** — three independent GPS sources feed the same pipeline: Traccar (Android,
   forwards via its own webhook to `POST /api/traccar/forward`), OwnTracks (recommended for iOS,
   `POST /api/owntracks/forward`), and Overland (built but not recommended — see README). Each
   maps to a member via the source-agnostic `device_id` field, writes to `runtime.positions`, and
   publishes a `position.updated` event over the in-process event bus. Every recorded position
   also runs through the trip detector (`app/trips.py`) and, on trip end, a Web Push notification
   if the household has any subscribed browsers.
2. **Live updates** — the dashboard holds one WebSocket connection (`/ws/events`) subscribed to
   every published event; the family map updates from that stream without polling.
3. **Health check** — `/health`/`/api/health` reports DB connectivity and uptime.

## Architecture Decision Records

### ADR-001 — FastAPI + React/Vite PWA over single-app scaffold
**Status:** Accepted
**Context:** The near2far spec calls for a modular, multi-service system (traccar, postgres,
redis, calendar-sync, notification-router, PWA) — not a single frontend/backend unit.
**Decision:** Scaffold as multi-service: FastAPI backend, React+Vite dashboard (serving as the
PWA shell), Postgres with pgvector+AGE.
**Consequences:** The live map, setup wizard, and member-management UI (this ADR originally called
it "trust-group UI" — that concept was dropped, see Data Model above) are built and working. redis
and calendar-sync from the original spec were never built — not needed for anything shipped so far.

### ADR-002 — Adjacent ports instead of range-spread defaults
**Status:** Accepted
**Context:** Scaffold-anything's default port ranges (FastAPI 5100-5199, Vite dev 5300-5399)
would have put backend and dashboard far apart.
**Decision:** Use adjacent ports instead: dashboard 5100, backend 5101. Confirmed clean via a
full grep of both `workspace-knightsrook` and `workspace-ns.s`, excluding `node_modules`/`dist`.
**Consequences:** Deviates from the scaffold tool's per-category range convention for this
project only. Recorded in `project:knightsrook:port-registry` (MCP) to prevent future collision.

### ADR-003 — Cloudflare "Flexible" SSL bypassed for GPS ingestion
**Status:** Accepted
**Context:** near2far.family runs behind Cloudflare with SSL mode "Flexible". Background
location-tracking apps (Overland, OwnTracks) pointed at the domain directly would connect, appear
to send successfully from the app's own perspective, and never arrive server-side — with zero
trace in application logs or Cloudflare's own firewall/security event log. Browsers and iOS
Shortcuts hitting the identical endpoint worked fine, isolating the fault to Cloudflare's handling
of that SSL mode for non-browser clients specifically.
**Decision:** GPS ingestion traffic bypasses Cloudflare's proxy entirely via a DNS-only ("grey
cloud") subdomain (`gps.near2far.family`, reusing the one Traccar's port already used) with a
real Let's Encrypt certificate — not a Cloudflare Origin Certificate, which only validates
Cloudflare↔origin traffic and is rejected by every other client once Cloudflare is bypassed.
**Consequences:** GPS apps must be configured against `gps.near2far.family`, not the main domain.
Full setup steps in README ("iOS GPS: use OwnTracks, not Overland").
