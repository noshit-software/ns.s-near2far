# knightsrook-near2far

Self-hosted family location + situational awareness. Private by default. Yours by design.

Part of noshit.software. AGPL-3.0. Domain: near2far.family

## Stack

- **backend/** — FastAPI, event bus, WebSocket stream to dashboard, setup API (household + members),
  `GET /api/positions/latest` for current per-member position, `POST /api/traccar/forward` — receives
  Traccar's position-forwarding webhook and maps it to a member via the source-agnostic `device_id`
  column — `POST /api/overland/forward` (deprecated in practice, see "iOS GPS" below — kept working
  but not recommended), and `POST /api/owntracks/forward`, the recommended iOS GPS source. Every
  recorded position also runs through `app/trips.py`'s in-memory per-member trip detector (speed-based:
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
  every member's latest reported position (Traccar, OwnTracks, or Overland — see "iOS GPS" below)
  renders as a circular avatar marker (their uploaded photo, or a generated placeholder — see
  "Member avatars"),
  shrinking through 80/60/40% size tiers and finally to a plain colored dot (20%) as you zoom out
  past neighborhood level, live-updated over the existing WebSocket event stream, with a bottom
  panel grid (one card per member: avatar, name, moving/stationary status with speed, and relative
  last-seen time) that flex-wraps along the bottom on wide/desktop viewports and stacks on portrait
  mobile — tapping a card centers the map on that member, snapping to a zoom level chosen from their
  last-known speed (closer for stationary/walking, wider for driving) rather than a fixed zoom. An
  "Enable trip alerts" banner subscribes the browser to Web Push. Since an installed PWA doesn't
  reliably recheck for a new deploy on its own (especially on iOS), the dashboard compares its loaded
  JS bundle against the server's on every foreground/focus and reloads automatically when they
  differ — no manual close/reopen needed after a rebuild. A round **SOS button** (bell icon) floats
  above the bottom tab bar (like a camera shutter button, clipped by the screen edge) — there are
  two ways to trigger it. **Triple-tapping it fires a general alert immediately**, no screen to
  navigate — the fast path for "I need this to go out right now." **A single tap instead opens a
  full-screen SOS panel**, semi-transparent over a blurred map rather than a fully opaque screen.
  A 2×2 grid of category tiles (Medical, Authority threat, Being followed, Car trouble — each a
  large icon filling most of the tile) takes up most of the space; 911 and up to 2 general
  contacts sit as big round dial buttons below the grid, dead center above the main SOS button,
  general contacts flanking left/right. Tapping a category tile fires a full alert for that
  category; each tile also shows up to 3 of its own configured numbers in a fixed-height strip at
  its bottom (e.g. AAA, insurance, and a non-emergency police line under Car trouble — Settings →
  Emergency contacts, per category, editable in place) — that strip always renders, even empty,
  so a tile's icon stays centered in the same spot whether or not it has numbers configured.
  Phone numbers are validated and normalized server-side
  (7-15 digits, optional leading `+`; punctuation/spacing stripped before storage) so a typo
  can't end up as a silently-dead `tel:` link discovered mid-emergency. Every number inside this
  panel is a single tap — no further triple-tap — since reaching the panel at all already
  required a deliberate first tap on the bell.
  Dialing a category-specific number is treated as a **lighter "help" tier**, not a full SOS: it
  still notifies every household device (so calling AAA doesn't happen silently), but as a small
  self-dismissing toast — no siren, no full-screen takeover, no persistent state to disable,
  since there's nothing actively wrong to resolve. Triple-tap, a category tile, and 911/general
  contacts are all full **"sos" tier**: the device's current location is reverse-geocoded to the
  nearest street (best-effort — see `backend/app/geocode.py`), the map flashes a pulsing marker at
  that location and flies to it, and every *other* connected household device (identified by a
  per-browser client id, so the triggering device never alarms on itself) gets a full-screen
  flashing red overlay — big centered category icon/label, address, siren (Web Audio, no bundled
  audio file), vibration — plus a Web Push notification if backgrounded/closed. That overlay's
  "Silence" button is local-only: it stops the sound/vibration on that one device but does **not**
  resolve the alert anywhere else, so it can't be used to make the alert disappear for everyone.
  Only the device that triggered it sees a persistent "SOS active" banner with a "Disable" control
  gated behind re-typing the admin password as a confirmation code — deliberately not a single tap,
  so whoever the emergency is about can't just grab the nearest phone and cancel it. Disabling
  broadcasts over the same WebSocket stream to clear every device's alarm and the map marker.
  The **Settings** tab has household/member
  management (home
  geofence via a Leaflet map you click to place a pin, member list — tapping a member opens a full
  **Edit member** modal: rename, avatar, a map-color picker, Device ID, and remove). No address
  search — Nominatim's free geocoder wasn't reliable enough at
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

`backend/uv.lock` is committed and the Docker build installs from it with `--frozen` — every build
gets the exact same dependency versions instead of whatever satisfies each package's `>=` range is
newest that day. To add or upgrade a backend dependency: edit `pyproject.toml`, run `uv lock` from
`backend/`, and commit the updated `uv.lock` alongside it — `--frozen` fails the build loudly if
the two ever drift apart instead of silently re-resolving.

## Tests

Backend unit tests (`backend/tests/`) cover the security-critical logic: password hashing,
`require_admin_auth`, OwnTracks' Basic-auth handling, the null-island rejection and
explicit-timestamp behavior in `_record_position`, and the trip-detection state machine. They run
against fake asyncpg-shaped connection objects (`tests/conftest.py`'s `FakeConn`), not a real
Postgres — fast, no Docker needed, safe to run in CI.

```bash
cd backend
uv sync
uv run pytest -v
```

Runs automatically on every push/PR via `.github/workflows/backend-tests.yml`. No frontend test
framework is set up yet (dashboard has no Vitest/Jest).

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

This endpoint originally had no auth of its own at all, relying entirely on `ufw` never exposing
it publicly — a single misconfigured firewall rule away from accepting fake position data from
anyone. Set `TRACCAR_FORWARD_TOKEN` in `.env` to a random secret and append `?token=<same value>`
to `TRACCAR_FORWARD_URL` (Traccar can't send custom headers, so the token has to live in the URL)
to close that gap. Leave both blank to keep the old network-only behavior.

## iOS GPS: use OwnTracks, not Overland

**Short version: don't use Overland.** A full night was burned chasing it — correct config
(Server URL, Access Token, Device ID all verified right), correct location permissions ("Always" +
Precise Location on), reachable network (confirmed via Safari and via an iOS Shortcuts POST to the
same endpoint) — and it still never reliably transmitted. `POST /api/overland/forward` still exists
in the backend (harmless to leave; it's a real, tested endpoint) in case a future Overland version
fixes whatever was wrong, but don't start a new install with it. Use **OwnTracks** instead — see
below. (If you do try Overland anyway: its **batch size floor is 50 with no way to set it lower**,
meaning up to a ~4 minute delay between map updates by design, not a bug — one more reason to skip
it.)

### OwnTracks (recommended)

[OwnTracks](https://owntracks.org/) is a free, open-source location tracker built specifically for
self-hosted setups like this one — no forced batch minimum, reports on its own time/distance
thresholds. Its HTTP-mode endpoint only supports **HTTP Basic auth** (username + password), not the
Bearer scheme every other endpoint here uses — `_verify_owntracks_auth` in `positions.py` handles
this separately.

**Why the backend matches by Basic-auth username, not OwnTracks' own "Tracker ID" field:**
OwnTracks has a "Tracker ID" (`tid`) setting that looks like the natural device identifier, but the
app caps it at **2 characters** by design (it's meant as a short map-pin label, not a real ID) —
useless as a real `device_id`. The Basic-auth **username** has no such limit and is sent with every
request anyway, so that's what `/api/owntracks/forward` actually matches members on.

1. In near2far's dashboard, open the member's **Edit member** modal (tap their row in Settings) and
   set **Device ID** to something meaningful, e.g. `alex-iphone`.
2. Install **OwnTracks** from the App Store. Open its settings (tap the **"i" icon**, top-left on
   the main map screen) → set **Mode** to **HTTP** (it defaults to MQTT, which is a different
   protocol entirely and won't work here).
3. Depending on the app version, the HTTP settings are either a single **URL** field, or split
   **Host** + **Path**:
   - Single field: **URL** = `https://near2far.family/api/owntracks/forward`
   - Split fields: **Host** = `near2far.family`, **Path** = `/api/owntracks/forward`
4. Turn **Auth** on. **Username** (sometimes labeled **UserID**) = the *exact same* string you set
   as Device ID in step 1 (e.g. `alex-iphone`). **Password** = the household admin password.
5. Leave **Tracker ID** as whatever default — it's unused for matching, only shows on OwnTracks'
   own internal map.
6. Turn on **Tracking Enabled**.

From then on it reports location to the family map over the same WebSocket stream Traccar uses.

**If it doesn't show up:** the single most likely cause on a real deploy is the Cloudflare issue
below, not anything in this list. Verify OwnTracks is actually configured right first (steps
above), then read on.

### Cloudflare "Flexible" SSL can silently block background location apps

This is the root cause that actually explains the whole Overland/OwnTracks saga, and will bite any
GPS-forwarding app pointed at `near2far.family` directly, not just those two specifically.

**The symptom:** the phone app is correctly configured, has a real GPS fix, "sends" with no visible
error — but nothing ever arrives server-side. `pm2 logs near2far` never shows the request at all
(not even a rejected/401 one). Meanwhile a plain browser (Safari) hitting the same domain, or an
iOS **Shortcuts** "Get Contents of URL" action making the identical POST, both work fine.

**The cause:** this domain's Cloudflare SSL/TLS mode is **Flexible** (browser↔Cloudflare is HTTPS,
Cloudflare↔origin is unencrypted HTTP). Cloudflare's own docs discourage Flexible mode for anything
beyond simple static sites — some non-browser HTTP clients (background location trackers among
them) handle it badly in ways that never surface as an error or a Cloudflare firewall/security
event, they just silently never complete.

**The fix:** bypass Cloudflare's proxy entirely for GPS ingestion, the same way Traccar's port 5055
already does, using a **DNS-only ("grey cloud") subdomain** instead of the normal proxied
(orange-cloud) one:

1. Cloudflare DNS: add an A record for a subdomain (e.g. `gps.near2far.family`, same one Traccar's
   port already uses) pointed at the VPS's IP, set to **DNS only** (grey cloud, not proxied).
2. Get a **real, publicly-trusted certificate** for it via Let's Encrypt — **do not** use a
   Cloudflare Origin Certificate here, it only validates Cloudflare↔origin traffic and is not
   trusted by any other client (curl, phone apps, anything) when Cloudflare is bypassed. This was
   tried and failed with `SSL certificate problem: unable to get local issuer certificate` before
   switching to Let's Encrypt:
   ```bash
   sudo apt install -y certbot python3-certbot-nginx
   sudo certbot --nginx -d gps.near2far.family
   ```
3. Add an nginx server block for it (certbot mostly writes this for you, but the shape is):
   ```nginx
   server {
       listen 443 ssl;
       server_name gps.near2far.family;
       # certbot fills in ssl_certificate / ssl_certificate_key here

       location /api {
           proxy_pass http://127.0.0.1:5101;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
       }
   }
   ```
4. `sudo ufw allow 443/tcp`, `sudo nginx -t && sudo systemctl reload nginx`.
5. Point OwnTracks (or whatever GPS app) at `https://gps.near2far.family/api/owntracks/forward`
   instead of `https://near2far.family/...`. Same Device ID/username/password — only the host
   changes.

Verify it's actually working before wiring up a phone: `curl -v https://gps.near2far.family/api/owntracks/forward`
should show a real, CA-trusted TLS handshake (`SSL certificate verify ok`) and get a response from
FastAPI (`405 Method Not Allowed` for a bare GET is correct — it proves the request reached the
app).

### Why a member's position can silently stay stuck at "null island" (0, 0)

`(0, 0)` is the standard placeholder value GPS sources send when they have no real fix yet — never
a genuine location. `_record_position` in `positions.py` rejects it outright (logs
`position_rejected_null_island`, doesn't insert). This matters for two reasons an installer should
know about:

- If every point a misconfigured device sends is `(0, 0)`, the map will just never update for that
  member and look identical to "nothing is arriving at all" — check `pm2 logs` for
  `position_rejected_null_island` to tell the two apart from a device that isn't connecting at all.
- Positions are ordered by each point's own reported timestamp (`recorded_at`), not by when the
  server received it — this matters because apps that queue points offline and flush them in a
  batch (Overland, OwnTracks) can deliver a stale `(0, 0)` point *after* a real one in the same
  batch; ordering by server-receipt time would have let the stale point win as "latest" purely by
  delivery order. Ordering by the device's own timestamp avoids that.

## Trip alerts (Web Push)

Every position recorded via any GPS source (Traccar, Overland, or OwnTracks) feeds
`app/trips.py`'s per-member trip detector:
speed above ~0.8 m/s (1.8 mph) starts a trip, stopping for 3+ minutes ends it, and the trip is
classified as driving vs walking by its average speed. On trip end, every browser that's enabled
alerts gets a push notification with distance/duration/avg speed. State is in-memory only — a
backend restart mid-trip just costs one missed alert, not persisted history.

1. On an existing install (VPS), run the schema migration — see "VPS deploy gotchas" below for
   exactly what's needed and why (`db/init/*.sql` reruns only pick up genuinely new tables like
   `substrate.push_subscriptions`, not new columns on existing ones).
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
row), a color picker for their map marker — 8 presets plus a native color-input swatch for any
custom color (`color` column; falls back to a color hashed from the member's id when unset, see
`resolveMemberColor` in `dashboard/src/lib/avatar.ts`), Device ID, and **Remove member**
(`DELETE /api/setup/members/{id}`, behind a confirm step) — which also deletes their uploaded
avatar file and cascades their position
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

### VPS deploy sequence

Run the same four steps every time, in this order, regardless of which files changed — the
gotchas below are all cases of skipping one because "only the frontend changed" or "only the
backend changed" seemed true at the time:

```bash
git pull
cd dashboard && npm run build && cd ..
pm2 restart near2far
docker compose up -d --build traccar   # only traccar runs in Compose on the VPS — the
                                        # backend/dashboard services in this compose file are
                                        # for local dev only; don't start them here, they'll
                                        # fight pm2/nginx for the same ports
```

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
  CASCADE;` (dropping/re-adding is the only way to change an existing FK's delete behavior). The
  SOS button needs `runtime.sos_alerts` on an existing install:
  ```sql
  CREATE TABLE IF NOT EXISTS runtime.sos_alerts (
    id BIGSERIAL PRIMARY KEY,
    household_id UUID NOT NULL REFERENCES substrate.households(id),
    lat DOUBLE PRECISION, lng DOUBLE PRECISION, address TEXT,
    category TEXT NOT NULL DEFAULT 'general',
    kind TEXT NOT NULL DEFAULT 'sos',
    contact_name TEXT,
    origin_client_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    acknowledged_at TIMESTAMPTZ
  );
  ```
  If `runtime.sos_alerts` already exists from an earlier deploy without `kind`/`contact_name`:
  `ALTER TABLE runtime.sos_alerts ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'sos', ADD
  COLUMN IF NOT EXISTS contact_name TEXT;`
  The one-tap emergency call buttons need `substrate.emergency_contacts` on an existing install
  (category `NULL` = general, shown for every SOS category; a specific category's contacts only
  show once that category is engaged):
  ```sql
  CREATE TABLE IF NOT EXISTS substrate.emergency_contacts (
    id BIGSERIAL PRIMARY KEY,
    household_id UUID NOT NULL REFERENCES substrate.households(id),
    category TEXT,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    sort_order INT NOT NULL DEFAULT 0
  );
  ```
- **Member photo uploads need `backend/uploads/` to persist and be writable.** Locally that's the
  `backend_uploads` docker volume; on the VPS (bare pm2, no container) it's just a directory next to
  the app code — make sure it survives deploys (it's not in git) and that the pm2 process can write
  to it.
- **The backend's Docker container runs as a non-root user (`appuser`, uid 1000) as of the
  security audit.** This only affects local `docker compose` dev — the VPS runs the backend bare
  via pm2, under whatever OS user pm2 itself runs as, entirely untouched by this. If you ever have
  an *existing local* `backend_uploads` volume from before this change, its files are still
  root-owned and need `docker compose down -v` (wipes and lets a fresh volume inherit the image's
  ownership) or a manual `docker compose exec -u root backend chown -R appuser:appuser
  /app/uploads`.
- **A browser's "This page isn't working" screen isn't necessarily a connectivity failure** — check
  for a specific HTTP status code in the error page (e.g. "HTTP ERROR 400") before assuming DNS/
  firewall/network issues; that generic wrapper renders for any 4xx/5xx response with an empty body.
- **A deployed frontend fix can be invisible even after confirming the new build is live on the
  server.** The dashboard's `index.html` needs an explicit no-cache header (`add_header
  Cache-Control "no-cache, must-revalidate";` in the nginx `location = /index.html` block) — the
  hashed asset filenames (`assets/index-<hash>.js/.css`) are safe to cache forever since the hash
  changes every build, but without this the HTML shell referencing them can get stuck cached
  indefinitely. An **installed PWA on iOS is worse** — it doesn't reliably recheck for a new page on
  every open even with the right headers now in place, so after a dashboard deploy that should be
  visible, also **delete the home-screen icon and re-add it** (Safari → the site → Share → Add to
  Home Screen) if the fix still doesn't show up. Verify what's actually live yourself before
  assuming a deploy failed: `curl -s https://near2far.family/assets/index-<hash>.css` (get the
  current hash from `curl -s https://near2far.family/ | grep -o 'assets/index-[^"]*\.css'`) and grep
  it for whatever CSS/behavior you just shipped.
- **Uploaded-photo re-crop silently failing for a specific image, previously flagged as
  unresolved, is fixed**: `AvatarCropper`'s save step (`ctx.drawImage`/`canvas.toBlob`) had no
  error handling at all — a thrown exception (e.g. a tainted-canvas security error) or a `null`
  blob from `toBlob` both failed with zero feedback. Now wrapped in `try`/`catch` with the failure
  surfaced as a real error message in the crop tool instead of a silent no-op.

## Auth

There's no global API key. Setup creates the household with an admin password, which the dashboard
stores locally and sends as a `Bearer` token. Endpoints besides `/health` and `/api/setup/household`
(GET) and `/api/setup/verify` require it once a household exists.

CORS defaults to allowing any origin (`*`) — auth here is a Bearer/Basic credential in a header,
not a cookie, so this doesn't expose the classic CSRF path a wildcard usually implies, but it's
still broader than a single-domain PWA needs. Set `CORS_ORIGINS` in `.env` (comma-separated) to
restrict it in production; left unset so this doesn't silently change behavior for existing
installs that haven't set it.

## Spec

Full product spec lives in the Knightsrook MCP knowledge base (`project:near2far:spec`, `project:near2far:funding`). See also [docs/architecture/overview.md](docs/architecture/overview.md) for the service-level architecture.

Note: the stored spec's trust-tier/redaction concept (intimate/named/ambient) was dropped during
implementation — decided it added complexity without a clear benefit for a family-safety tool, where
knowing someone's exact location is the point. The spec doc hasn't been updated to reflect this yet.
