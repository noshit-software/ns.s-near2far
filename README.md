# knightsrook-near2far

Self-hosted family location + situational awareness. Private by default. Yours by design.

Part of noshit.software. AGPL-3.0. Domain: near2far.family

## Stack

- **backend/** — FastAPI, event bus, WebSocket stream to dashboard, setup API (household + members),
  `GET /api/positions/latest` for current per-member position, `POST /api/traccar/forward` — receives
  Traccar's position-forwarding webhook and maps it to a member via the source-agnostic `device_id`
  column — and `POST /api/overland/forward`, the same mapping for the [Overland](https://overland.p3k.app/)
  iOS app (Traccar Client is unreliable on iOS; Overland is the iPhone GPS source). Every recorded
  position also runs through `app/trips.py`'s in-memory per-member trip detector (speed-based:
  moving/stationary thresholds, walking vs driving by average speed over the trip) — on trip end it
  sends a Web Push notification ("Alex stopped — finished driving, 4.2 km in 9 min, avg 28 km/h") to
  every browser subscribed via `POST /api/push/subscribe`. See "Trip alerts" below. Members also have
  `POST /api/setup/members/{id}/avatar` (multipart photo upload, JPEG/PNG/WebP, 5MB max, saved under
  `uploads/avatars/` and served at `/uploads/avatars/<filename>`) and `POST
  /api/setup/members/{id}/avatar-seed` (picks a generated placeholder avatar — see "Member avatars"
  below).
- **dashboard/** — React+Vite PWA styled as a native-feeling app shell (fixed top bar + bottom tab
  bar around a scrollable content area, `100dvh` height, `env(safe-area-inset-*)` padding for iOS/
  Android notches and home indicators, `viewport-fit=cover` + `apple-mobile-web-app-*` meta tags for a
  chromeless standalone install on both platforms). The **Map** tab is a full-bleed live family map:
  every member's latest reported position (currently via Traccar/real phone GPS) renders as a
  circular avatar marker (their uploaded photo, or a generated placeholder — see "Member avatars"),
  shrinking to a plain colored dot once zoomed out past neighborhood level, live-updated over the
  existing WebSocket event stream, with a floating row of "snap to" pills (each with a small avatar)
  over the bottom of the map to quickly center on any member, and an "Enable trip alerts" banner that
  subscribes the browser to Web Push. The **Settings** tab has household/member management (home
  geofence via a Leaflet map you click to place a pin, member list, per-member device linking, and an
  avatar picker per member). No address search — Nominatim's free geocoder wasn't reliable enough at
  house-level precision to be worth the confusion. No trust tiers — every member sees every other
  member's exact location; that's the whole point for a family-safety use case. Place alerts
  (geofence-based) are still a placeholder.
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

## Overland (iOS GPS — Traccar Client is unreliable on iPhone)

[Overland](https://overland.p3k.app/) is a paid iOS app that posts location batches to a configured
URL. Unlike Traccar's `:5055` port, this hits the backend directly and is exposed publicly, so the
endpoint requires the household admin password as a bearer token (same `require_admin_auth`
dependency the dashboard API uses).

1. In near2far's dashboard Settings, set the member's "Device ID" field to whatever you'll enter as
   Overland's Device ID (e.g. `alex-iphone`).
2. In the Overland app, set:
   - **Receiver Endpoint URL**: `https://near2far.family/api/overland/forward`
   - **Access Token**: the household admin password
   - **Device ID**: the same identifier you set in Settings
3. Overland forwards location batches from then on; the backend maps each by `device_id` and pushes
   it to the family map over the same WebSocket stream Traccar and browser-geolocation use.

## Trip alerts (Web Push)

Every position recorded via Traccar or Overland feeds `app/trips.py`'s per-member trip detector:
speed above ~0.8 m/s (1.8 mph) starts a trip, stopping for 3+ minutes ends it, and the trip is
classified as driving vs walking by its average speed. On trip end, every browser that's enabled
alerts gets a push notification with distance/duration/avg speed. State is in-memory only — a
backend restart mid-trip just costs one missed alert, not persisted history.

1. On an existing install (VPS), the `db/init/*.sql` scripts only run once — rerunning
   `docker compose exec db psql -U near2far -d near2far -f /docker-entrypoint-initdb.d/02-schema.sql`
   is safe for *new tables* (`CREATE TABLE IF NOT EXISTS` — this is how `substrate.push_subscriptions`
   gets created on an existing install) but does **nothing** for new columns on a table that already
   exists, like `avatar_filename`/`avatar_seed` on `substrate.members` — `CREATE TABLE IF NOT EXISTS`
   skips the whole statement if the table's already there. Those need an explicit `ALTER TABLE`:
   ```sql
   ALTER TABLE substrate.members ADD COLUMN IF NOT EXISTS avatar_filename TEXT;
   ALTER TABLE substrate.members ADD COLUMN IF NOT EXISTS avatar_seed TEXT NOT NULL
     DEFAULT substr(md5(random()::text || clock_timestamp()::text), 1, 10);
   ```
2. Generate a VAPID keypair (from `backend/`): `uv run --with pywebpush python -c "..."` (or any
   VAPID keygen tool) — you need the raw base64url public/private key bytes, not PEM. Paste them into
   `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` in `.env`.
3. Restart the backend so it picks up the keys (`pm2 restart near2far` on the VPS, `docker compose up
   -d backend` locally).
4. In the dashboard, click **Enable trip alerts** (appears above the map once a household exists) and
   accept the browser's notification permission prompt. This POSTs the browser's push subscription to
   `/api/push/subscribe`, authenticated with the admin password like every other settings write.
5. Dead subscriptions (uninstalled PWA, revoked permission) are pruned automatically the next time a
   push to them 404s/410s.

Leaving `VAPID_PRIVATE_KEY` blank disables push entirely — the trip detector still runs (harmless) but
`send_push_to_household` no-ops, and the dashboard's enable button hides itself once it sees no key
returned from `/api/push/vapid-public-key`.

## Editing a member

Tapping a member's row in Settings opens a bottom-sheet **Edit member** modal — the one place
for everything about that member: avatar (see below), rename (`POST /api/setup/members/{id}`,
partial update via `COALESCE` — also handles color, since both are optional fields on the same
row), an 8-color preset picker for their map marker (`color` column; falls back to a color
hashed from the member's id when unset, see `resolveMemberColor` in `dashboard/src/lib/
avatar.ts`), Device ID, and **Remove member** (`DELETE /api/setup/members/{id}`, behind a
confirm step) — which also deletes their uploaded avatar file and cascades their position
history (`positions.member_id` has `ON DELETE CASCADE`).

## Member avatars

Every member gets a randomly-assigned placeholder avatar at creation (`avatar_seed`, a random
token — the dashboard turns it into an image via `@dicebear/collection`'s `funEmoji` style,
rendered **fully client-side, no network calls** — consistent with near2far's self-hosted/
private-by-default stance; no third-party avatar CDN is ever contacted). In Settings, tap a
member's avatar to open a picker: 6 fresh random options plus a **Shuffle** button for more, or
**Upload photo** to use a real picture instead — an uploaded photo always takes priority over the
generated one. Photos are stored server-side under `backend/uploads/avatars/` (a docker volume
locally; just a directory on the VPS since the backend runs bare via pm2) and served at
`/uploads/avatars/<filename>`, proxied through nginx/vite same as `/api`.

The backend caps uploads at 5MB, but **nginx's own default body-size limit is 1MB** and rejects
anything bigger before the backend ever sees it, with an HTML error page instead of JSON (surfaces
in the dashboard as a cryptic "Unexpected token '<'..." error). The dashboard's own `nginx.conf`
sets `client_max_body_size 6M;`, but the VPS's site-block nginx config for `near2far.family` is a
separate file (see "Traccar" section above for the pattern) and needs the same directive added by
hand — it isn't picked up from this repo automatically.

On the map, avatars render as circular markers, cropped via CSS (`background-image` +
`border-radius: 50%`), with a per-member colored border/dot color derived deterministically from
their member ID (see `dashboard/src/lib/avatar.ts`). Below zoom level 15 they shrink to a plain
colored dot — a full avatar reads as visual noise once the map is showing a whole city rather than
a neighborhood.

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
  them to an already-running database. `avatar_filename`/`avatar_seed`/`color` on
  `substrate.members` and `substrate.push_subscriptions` are all examples of columns/tables added
  after initial release. `color` needs `ALTER TABLE substrate.members ADD COLUMN IF NOT EXISTS
  color TEXT;` on an existing install; `positions.member_id`'s `ON DELETE CASCADE` needs `ALTER
  TABLE runtime.positions DROP CONSTRAINT positions_member_id_fkey, ADD CONSTRAINT
  positions_member_id_fkey FOREIGN KEY (member_id) REFERENCES substrate.members(id) ON DELETE
  CASCADE;` (dropping/re-adding is the only way to change an existing FK's delete behavior).
- **Member photo uploads need `backend/uploads/` to persist and be writable.** Locally that's the
  `backend_uploads` docker volume; on the VPS (bare pm2, no container) it's just a directory next to
  the app code — make sure it survives deploys (it's not in git) and that the pm2 process can write
  to it.
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
