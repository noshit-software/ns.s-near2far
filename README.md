# knightsrook-near2far

Self-hosted family location + situational awareness. Private by default. Yours by design.

Part of noshit.software. AGPL-3.0. Domain: near2far.family

## Stack

- **backend/** — FastAPI, event bus, WebSocket stream to dashboard (with 30 s keepalive ping to survive nginx's 60 s proxy_read_timeout), setup API (household + members),
  `GET /api/positions/latest` for current per-member position, `POST /api/traccar/forward` — receives
  Traccar's position-forwarding webhook and maps it to a member via the source-agnostic `device_id`
  column — `POST /api/overland/forward` (not the default path, see "Alternative GPS sources"
  below), and `POST /api/owntracks/forward`, the recommended GPS source for every platform. Every
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
  chromeless standalone install on both platforms). The tab bar's Map/Settings buttons are
  icon-only (no text label), both sized and vertically centered to match the SOS bell/notification
  icon between them. The **Map** tab is a full-bleed live family map:
  every member's latest reported position (OwnTracks, Traccar, or Overland — see "GPS setup" below)
  renders as a circular avatar marker (their uploaded photo, or a generated placeholder — see
  "Member avatars"),
  shrinking through 80/60/40% size tiers and finally to a plain colored dot (20%) as you zoom out
  past neighborhood level, live-updated over the existing WebSocket event stream — which re-fetches
  `/api/positions/latest` outright whenever the socket reconnects or the tab becomes visible again
  (`lib/ws.ts`'s `ws.reconnected` signal, `FamilyMap`'s `visibilitychange` listener), so a
  backgrounded/locked/slept device that missed updates while its socket was silently dead catches
  up instead of leaving a marker frozen at its last-known spot. A one-click
  quick-select strip of thumbnail avatars sits along the bottom — thumb-sized so a typical
  household's members all fit on one row with no scrolling — with a single expanded detail card
  below it (avatar, name, moving/stationary status with speed, relative last-seen time, and a red
  low-battery badge once their phone's reported level drops to 20% or below) for
  whichever member is currently selected; tapping an avatar in the strip selects that member,
  centers the map on them (speed-adaptive zoom), and keeps the map continuously panned to their
  position as updates arrive — tapping the selected avatar again (shown with a ✕ overlay) deselects
  and returns the map to fit-all mode. When no member is selected the map stays fitted to all
  members and re-fits on each update. Speed in the detail card shows mph (bold) and km/h side by
  side; implausible readings from GPS noise (sub-5 s intervals or above 216 km/h) are discarded. An
  "Enable trip alerts" button (Settings, above "Home" — not on the map itself) subscribes
  the browser to Web Push; it renders nothing once already subscribed. Since an installed PWA doesn't
  reliably recheck for a new deploy on its own (especially on iOS), the dashboard compares its loaded
  JS bundle against the server's on every foreground/focus and on a 3-minute interval (iOS PWA
  drops visibility events unreliably), then navigates to a cache-busting URL rather than calling
  `reload()` — iOS PWA can silently serve the old cached shell through a plain reload despite
  no-cache headers. No manual close/reopen needed after a rebuild. The whole app shell — top bar, tab bar,
  member panel cards, settings/setup cards, and the SOS panel — shares one "liquid glass" look:
  heavily blurred, translucent surfaces with a bright inner-edge highlight, so whatever's behind
  (map, page content) stays visible through them instead of a solid card sitting on top. A round
  **SOS button** (bell icon, watermarked with `homeworld.png`) floats above the bottom tab bar
  (like a camera shutter button, clipped by the screen edge). A single tap opens a full-screen SOS
  panel with large squircle corners — the bell itself is replaced by a round button in the exact
  same spot (also watermarked with `homeworld.png`), since once the panel is open the bell has
  nothing further to do; that button dials whatever household emergency number is configured in
  Settings → "Emergency number" (911 by default, but not every region uses 911 — e.g. 112, 999),
  with a phone icon and the configured label curving in an arc above it (SVG `textPath`) rather
  than sitting as flat stacked text, tinted the brand orange (see "Branding" below) rather than a
  stock red. Up to 2 general contacts flank it left/right, tinted the logo's light blue-gray. A
  2×2 grid of category tiles (Medical, Authorities, Followed, Car trouble) fills most
  of the remaining space above — each tile carries a small (30px) badge icon flush in its
  top-left corner (gray on orange, matching the corner's curve rather than a full circle)
  followed by a centered label bar spanning the rest of that top edge (e.g. "MEDICAL",
  "AUTHORITIES") — both are `clamp()`-sized, not a large fixed centered/watermark icon, since a
  bigger fixed icon kept getting covered as the tile's content below it grew, and fixed sizing in
  general didn't adapt below the ~390px+ viewport this had only ever been checked at. The
  SOS-relevant icons in
  `dashboard/src/components/icons.tsx` — `BellIcon`, `PhoneIcon`, `MedicalCrossIcon`,
  `BadgeIcon` (Authorities), `SuspiciousIcon` (Followed — a domino mask glyph), `CarIcon` — are
  exact Google Material Symbols glyphs (`fill="currentColor"`, `viewBox="0 -960 960 960"`),
  inlined as plain `<svg>` per component rather than hand-drawn approximations; the rest of that
  file's icons (`MapIcon`, `SettingsIcon`, `CloseIcon`, etc.) are simpler hand-drawn stroke icons.
  Tapping a category tile's icon fires a full alert for
  that category; below the icon, up to two collapsed-glass **sections** — each omitted entirely
  when it has nothing to show — hold that category's configured numbers: **quick dial** (each
  number its own chip with a small phone-icon badge overlapping the chip's own top edge, centered
  — reads as a row of "chain links" between the buttons rather than one icon labeling the whole
  section and eating space every chip didn't need) and **notes** (no icon at all — just the text,
  one line per contact with notes, e.g. a policy number — rolled up panel-wide rather than
  squeezed under each individual number). Configured per category in Settings → Emergency
  contacts (editable and
  reorderable in place); contact names are capped at 18 characters both client-side (`maxLength`)
  and server-side (`MAX_CONTACT_NAME_LENGTH` in `backend/app/api/setup.py`). Phone numbers are
  validated and normalized server-side (7-15 digits, optional leading `+`; punctuation/spacing
  stripped before storage) so a typo can't end up as a silently-dead `tel:` link discovered
  mid-emergency. Opening the panel itself takes **3 taps on the bell within ~1.2s of each
  other** (a "N more" counter shows on each intermediate tap) — deliberate friction so a
  pocket-press or accidental brush can't trigger it, without needing a modal confirmation once
  you're actually in an emergency. Every number *inside* the panel is a single tap once you're
  there — reaching the panel at all was already the deliberate step.
  If the browser triggering it has no GPS of its own (e.g. a desktop), the alert falls back to
  the household's most recently reported position from any tracked member rather than sending
  "Location unavailable" — not guaranteed to be the specific person triggering it (there's no
  per-device member identity), but a recent real position beats nothing.
  Dialing a category-specific number is treated as a **lighter "help" tier**, not a full SOS: it
  still notifies every household device (so calling AAA doesn't happen silently), but as a small
  self-dismissing toast — no siren, no full-screen takeover, no persistent state to disable,
  since there's nothing actively wrong to resolve. A category tile and 911/general contacts are
  all full **"sos" tier**: the device's current location is reverse-geocoded to the
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
  Every tap that happens during an active alert — a category tile fired, a number called —
  gets appended to `runtime.sos_alert_actions` (`POST /api/sos/{id}/actions`) and broadcast live
  over the same WebSocket stream (`sos.action_logged`), so both the triggering device's "SOS
  active" banner and every other device's full-screen overlay show a live-updating trail of
  what's happening, not just the original trigger.
  The **Settings** tab has household/member
  management (home
  geofence via a Leaflet map you click to place a pin, member list — tapping a member opens a full
  **Edit member** modal: rename, avatar, a map-color picker, Device ID, and remove). No address
  search — Nominatim's free geocoder wasn't reliable enough at
  house-level precision to be worth the confusion. No trust tiers — every member sees every other
  member's exact location; that's the whole point for a family-safety use case. Place alerts
  (geofence-based) are still a placeholder.
- **Geofence arrival audio** — the dashboard plays a chime when a member enters a saved place. Home arrivals get a 4-note ascending arpeggio (C–E–G–C); other places get a softer 2-note chime. Plays via Web Audio API in the browser tab; no files needed. Different tones per place-type are wired — individual per-place tone selection can be added later in Settings.
- **OwnTracks staleness alerts** — background watcher fires a push notification when any member's last location is more than 30 minutes old; clears automatically on recovery. A stale indicator (amber dot on avatar, warning line in detail panel) also appears on the map.
- **Map layers** — toggleable overlays on the family map (🔥 wildfire perimeters, 🧊 ICE activity). Fire perimeters are fetched from the Interior/NIFC ArcGIS public endpoint (`/api/layers/wildfire`, 10-minute cache) and rendered as orange polygons with a 🔥 centroid marker; tap for name and acreage. ICE activity is fetched from the StopICE Alerts Network API (`/api/layers/ice?lat=&lng=&distance=20`, 5-minute cache) keyed to the current map center; requires `STOPICE_API_KEY` in the backend env. Tap any 🧊 marker for address, age, description, and a link to the full stopice.net report.
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

## Demo stack (for showing this off without exposing real family data)

A second, fully isolated stack — its own containers, Postgres volume, and ports — seeded with a
fake household ("The Petersons", 5 members, 12 emergency contacts spread across every SOS
category, live-looking positions around downtown Seattle). No Traccar (a demo doesn't need real
GPS devices). See `scripts/seed-demo.sh` for the exact seeded data — deliberately not enumerated
here in detail, since that script is what actually stays in sync when it changes.

```bash
cp .env.demo.example .env.demo   # fill in a Postgres password, same as .env/.env.example
docker compose -p nss-near2far-demo -f docker-compose.demo.yml --env-file .env.demo up -d --build
./scripts/seed-demo.sh   # safe to re-run — wipes and reseeds the demo household each time
```

- Dashboard: http://localhost:5120 (admin password printed by the seed script: `demo-admin-pass`)
- API: http://localhost:5121/health

Wipe it entirely: `docker compose -p nss-near2far-demo -f docker-compose.demo.yml down -v`.
`.env.demo` uses its own random Postgres password and ports (5120/5121, Postgres exposed on
5434) so it can run alongside the real stack (`.env`, ports 5100/5101) without colliding.

## Tests

Backend unit tests (`backend/tests/`) cover the security-critical logic: password hashing,
`require_admin_auth`, OwnTracks' Basic-auth handling, the null-island rejection and
explicit-timestamp behavior in `_record_position`, the trip-detection state machine, and phone/
contact-name validation (`_normalize_phone`/`_validate_contact_name` in `setup.py`). They run
against fake asyncpg-shaped connection objects (`tests/conftest.py`'s `FakeConn`), not a real
Postgres — fast, no Docker needed, safe to run in CI.

```bash
cd backend
uv sync
uv run pytest -v
```

Runs automatically on every push/PR via `.github/workflows/backend-tests.yml`.

**Known coverage gaps**: `setup.py`'s route handlers themselves (household/member/emergency-contact
CRUD, the cap-enforcement transaction, avatar upload) and all of `sos.py` (trigger/acknowledge) have
no tests — only the pure validation helpers pulled out of `setup.py` are covered. Testing the routes
would mean either a `FakeConn` with a working `.transaction()` context manager or spinning up a real
Postgres in CI; neither is done yet. No frontend test framework is set up either (dashboard has no
Vitest/Jest) — both are open follow-ups, not silently skipped.

## GPS setup: OwnTracks (recommended, iOS and Android)

**Default recommendation for every install, either platform.** Earlier revisions of this README
scoped OwnTracks as "the iOS option" (with Traccar Client for Android) — that was never actually a
platform limitation, OwnTracks has real apps for both iOS and Android (plus F-Droid), it just hadn't
been tried on Android yet at the time. Reports over plain HTTPS, no separate server-side service to
run, no phone-reachable UDP port to expose — genuinely simpler to set up than Traccar on any
platform. Traccar and the (likely now-fixable) Overland option are documented below under
"Alternative GPS sources" for anyone who wants them, but they're not the default path anymore.

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

**Shortcut**: after setting a member's Device ID (step 1 below), the Edit member modal shows a
**"Configure OwnTracks app with this Device ID"** link — tap it *on the phone being set up* (i.e.
open the near2far dashboard in that phone's own browser, not from another device) and it deep-links
into OwnTracks with steps 2-5 below already filled in. Falls back to manual entry if OwnTracks
isn't installed yet or the link doesn't fire — the steps below always work regardless.

1. In near2far's dashboard, open the member's **Edit member** modal (tap their row in Settings) and
   set **Device ID** to something meaningful, e.g. `alex-phone`.
2. Install **OwnTracks** from the App Store (iOS) or Google Play/F-Droid (Android). Open its
   settings (iOS: tap the **"i" icon**, top-left on the main map screen; Android: hamburger menu →
   Preferences → Connection) → set **Mode** to **HTTP** (it defaults to MQTT, which is a different
   protocol entirely and won't work here).
3. Depending on the app version, the HTTP settings are either a single **URL** field, or split
   **Host** + **Path**:
   - Single field: **URL** = `https://near2far.family/api/owntracks/forward`
   - Split fields: **Host** = `near2far.family`, **Path** = `/api/owntracks/forward`
4. Turn **Auth** on. **Username** (sometimes labeled **UserID**) = the *exact same* string you set
   as Device ID in step 1 (e.g. `alex-phone`). **Password** = the household admin password.
5. Leave **Tracker ID** as whatever default — it's unused for matching, only shows on OwnTracks'
   own internal map.
6. Turn on **Tracking Enabled**.

From then on it reports location to the family map over `/ws/events`, the same WebSocket stream
every GPS source (Traccar, Overland) uses regardless of which one sent it.

**If it doesn't show up:** the single most likely cause on a real deploy is the Cloudflare issue
below, not anything in this list. Verify OwnTracks is actually configured right first (steps
above), then read on.

**If OwnTracks itself shows a "malformed JSON"/serialization error and then goes silent
entirely** (nothing further reaches the server, even after re-saving the config): `/api/owntracks/forward`
must always respond with a JSON **array** (`[]` on success — OwnTracks' HTTP mode parses the
response body as a list of waypoints/cards to display), never `{}`. This endpoint returned `{}`
for a while, which at least some Android client versions parse strictly enough to throw a
serialization exception on — and that failure can jam the app's own local report queue
indefinitely, not just drop the one bad request. Symptom: the map shows a real but stale
position that never advances, even though the phone's tracking is nominally "on." Fixed as of
this commit; if it happens on an older deploy, `git pull` + redeploy the backend, then on the
phone force-stop OwnTracks and clear its app storage (Android: Settings → Apps → OwnTracks →
Storage → Clear Data) to flush whatever's stuck in its local queue before re-configuring it.

**If OwnTracks' own log shows `HTTP request failed. Status: 422`** after clearing a backed-up
queue and re-publishing: OwnTracks batches its whole local queue into a single JSON **array**
POST when flushing a backlog (rather than one request per point), and `/api/owntracks/forward`
originally only accepted a single location object — a batch flush 422'd the entire array at
once against that shape. The endpoint now accepts either a single object or an array and
processes each report in the array in order (same handler, see
`backend/app/api/positions.py`'s `owntracks_forward`), so a queued backlog flushes cleanly
instead of failing outright.

A related follow-up: OwnTracks' HTTP endpoint delivers more than plain locations through this
same endpoint — `waypoints`, `transition`, and `card` message types get queued and flushed
alongside `location` reports, and none of those other types carry a top-level `lat`/`lon` at
all. `OwnTracksLocation` originally required both fields unconditionally, so a batch containing
even one non-location message 422'd the *whole* request before the handler's own
`type_ != "location"` skip ever ran. `lat`/`lon` are now optional on the model (only read when
`type_ == "location"` and both are actually present), so a mixed batch — locations, waypoints,
whatever else — processes cleanly instead of failing on the first non-location item it hits.

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

## Alternative GPS sources (Traccar, Overland)

Not the default — OwnTracks above covers iOS and Android with less setup and no phone-reachable
port to expose. These exist for anyone who's already using one of them or wants a self-hosted
server-side option instead of a phone-app-only one.

### Traccar

Not started by default — it's an opt-in Compose profile (`profiles: ["traccar"]` in
`docker-compose.yml`), so `docker compose up -d` alone never runs it. Start it explicitly with
`docker compose --profile traccar up -d traccar` if you actually want it.

The web UI (:8082) is bound to `127.0.0.1` in `docker-compose.yml`, not exposed publicly — reach it
through an nginx-proxied subdomain instead (e.g. `traccar.near2far.family`, same pattern as
`near2far.family` itself: an nginx site block proxying to `127.0.0.1:8082`, plus a Cloudflare DNS
record for that subdomain).

1. Open the Traccar web UI at `https://traccar.near2far.family` (first visit lets you create the admin
   account — there's no default, and this account is what `TRACCAR_ADMIN_EMAIL`/`TRACCAR_ADMIN_PASS`
   below need to match).
2. **Either** create a device by hand (Settings → Devices → Add, any identifier you want, e.g.
   `alex-phone`), **or** set `TRACCAR_API_URL`/`TRACCAR_ADMIN_EMAIL`/`TRACCAR_ADMIN_PASS` in `.env`
   (see `.env.example`) and skip straight to step 4 — saving a member's Device ID in near2far's own
   Settings then auto-creates the matching Traccar device via its API
   (`backend/app/traccar_admin.py`), best-effort (silently falls back to "do it by hand" if the
   call fails or those env vars aren't set).
3. Install the **Traccar Client** app on that member's phone, set the identifier to match, and set the
   server URL to `http://<server>:5055` (this port stays exposed directly — phones talk to it, not
   through nginx/Cloudflare; on a PaaS deploy without raw port exposure, this option isn't viable —
   use OwnTracks instead).
4. In near2far's dashboard Settings, paste that same identifier into the member's "Device ID" field
   and Save.

From then on, Traccar forwards every position update to the backend (`TRACCAR_FORWARD_URL`, see
`.env.example`), which maps it to that member and pushes it to the family map over the same
`/ws/events` stream every source uses. (There's no browser self-geolocation reporting anymore —
removed in favor of the snap-to-member map controls; every position comes from a real GPS source.)

`TRACCAR_FORWARD_URL` differs by deployment:
- Local all-in-one docker-compose dev: `http://backend:8000/api/traccar/forward`
- VPS (backend runs via pm2, not in this compose file): `http://host.docker.internal:5101/api/traccar/forward`

This endpoint originally had no auth of its own at all, relying entirely on `ufw` never exposing
it publicly — a single misconfigured firewall rule away from accepting fake position data from
anyone. Set `TRACCAR_FORWARD_TOKEN` in `.env` to a random secret and append `?token=<same value>`
to `TRACCAR_FORWARD_URL` (Traccar can't send custom headers, so the token has to live in the URL)
to close that gap. Leave both blank to keep the old network-only behavior.

### Overland (iOS) — probably fine now, wasn't tested against the real root cause

A full night was once burned chasing Overland never reliably transmitting — correct config, correct
"Always" + Precise Location permissions, reachable network (confirmed via Safari and an iOS
Shortcuts POST to the same endpoint) — and it still silently failed. At the time this got written
off as "something wrong with Overland." In hindsight, the actual root cause found later (see
"Cloudflare 'Flexible' SSL can silently block background location apps" above) fully explains that
exact symptom — a correctly-configured non-browser HTTP client silently failing against a
Cloudflare Flexible-SSL domain, while Safari and Shortcuts (different HTTP client behavior) worked
fine against the same URL. Overland was never re-tested against a DNS-only ("grey cloud") subdomain
after that fix, so it's plausible it actually works fine now. `POST /api/overland/forward` still
exists in the backend (a real, tested endpoint) — worth retrying if you specifically want it, just
point it at the grey-cloud subdomain from the start rather than repeating the original debugging
session. One real downside either way: its **batch size floor is 50 with no way to set it lower**,
meaning up to a ~4 minute delay between map updates by design, not a bug.

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
4. In the dashboard, go to Settings and click **Enable trip alerts** (at the top, once a household
   exists) and accept the browser's notification permission prompt. This POSTs the browser's push subscription to
   `/api/push/subscribe`, authenticated with the admin password like every other settings write.
5. Dead subscriptions (uninstalled PWA, revoked permission) are pruned automatically the next time a
   push to them 404s/410s.

Leaving `VAPID_PRIVATE_KEY` blank disables push entirely — the trip detector still runs (harmless) but
`send_push_to_household` no-ops, and the dashboard's enable button hides itself once it sees no key
returned from `/api/push/vapid-public-key`.

## Low-battery alerts (Web Push)

OwnTracks reports battery percentage on every location update (`batt`, 0-100); Traccar and Overland
don't send one, so members on those sources just never trigger this. `app/battery_alerts.py` mirrors
`trips.py`'s per-member in-memory state pattern: the first report at or below 20% fires a single push
("Alex's phone is low on battery"), then stays quiet on every subsequent low report from that member
until their battery climbs back above 40% — a hysteresis gap so it doesn't re-fire on every position
update while hovering around the threshold. Uses the same push subscriptions/VAPID setup as trip
alerts above — no separate opt-in. The map's member-detail panel shows a red battery badge under the
same 20% threshold.

## Place alerts (Web Push)

Beyond the "Home" geofence every household already has, Settings has a **Places** list (school,
work, grandma's, etc. — add/edit/remove, same click-to-place-pin picker as Home) backed by
`substrate.places`. `app/geofence_alerts.py` checks every recorded position against Home plus all
of a household's places and, on each arrive/leave transition, sends a push ("Alex arrived at
School" / "Alex left Work") — same per-member in-memory state pattern as trip and battery alerts,
same push subscriptions/VAPID setup, no separate opt-in.

## Editing a member

Tapping a member's row in Settings opens a bottom-sheet **Edit member** modal — the one place
for everything about that member: avatar (see below), rename (`POST /api/setup/members/{id}`,
partial update via `COALESCE` — also handles color, since both are optional fields on the same
row), a color picker for their map marker — 8 presets plus a native color-input swatch for any
custom color (`color` column; falls back to a color hashed from the member's id when unset, see
`resolveMemberColor` in `dashboard/src/lib/avatar.ts`), Device ID (its own endpoint,
`POST /api/setup/members/{id}/device`, separate from the rename/color one — returns 409 if
that device ID is already linked to another member), and **Remove member**
(`DELETE /api/setup/members/{id}`, behind a confirm step) — which also deletes their uploaded
avatar file and cascades their position
history (`positions.member_id` has `ON DELETE CASCADE`).

## Branding

App icons, favicon, and the color palette (`dashboard/src/index.css` `:root`/light-mode
variables) are derived from `dashboard/public/n2f-logo.svg` — navy `#293a4e`, orange `#d97110`
(the `--accent` used for buttons/CTAs and the SOS/911 buttons), and blue-gray `#8ba6c1`/`#5980a6`
(used for the SOS panel's general-contact pills/icon badges). `icon-192.png`, `icon-512.png`, and
`favicon.ico` are generated from `n2f-logo.png` (PIL, `favicon.ico` bundling 16/32/48/64px). The
logo content only fills ~70% of each icon's canvas, not edge-to-edge — the original generation
had it flush with the canvas border, which meant Android/iOS's circular/squircle home-screen
icon mask (which crops well inside the square canvas, not just at its edges) sliced right
through the outer ring and the rocket poking above it. Regenerate them if the logo changes —
there's no build step wired up for this, it was a one-off script; keep the ~70%-content/~30%-
padding ratio so a fresh logo doesn't reintroduce the same clipping.

## Member avatars

Every member gets a randomly-assigned placeholder avatar at creation (`avatar_seed`, a random
token — the dashboard turns it into an image via `@dicebear/collection`'s `funEmoji` style,
rendered **fully client-side, no network calls** — consistent with near2far's self-hosted/
private-by-default stance; no third-party avatar CDN is ever contacted). In Settings, tap a
member's avatar to open a picker — rendered as a fixed, centered viewport overlay (not positioned
relative to the avatar button) since it's nested inside the **Edit member** bottom sheet, which is
itself a scrollable/height-constrained container; an absolutely-positioned dropdown there got
clipped by the sheet's own bounds instead of just fitting itself to the screen (same class of bug
as the `backdrop-filter`/`position:fixed` containing-block trap below, different root cause). Its
6 candidate options wrap as flex rows sized to fill the panel rather than a fixed grid, so it never
needs to scroll for the fixed candidate count. 6 fresh random options plus a **Shuffle** button, or
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

The dashboard runs in Docker; the backend runs bare via pm2. Run all three steps every time
regardless of which files changed:

```bash
git pull
docker compose build --no-cache dashboard && docker compose up -d --no-deps dashboard
pm2 restart near2far
```

`--no-cache` is required — without it Docker reuses a cached `npm run build` layer and the bundle hash never changes, so the new code is silently never served. `--no-deps` prevents compose from trying to recreate the backend/db containers (which aren't needed and can fail in production).

`traccar` is profile-gated and off by default — only run
`docker compose --profile traccar up -d --build traccar` if you're actually using Traccar.

### System nginx must proxy to Docker, not serve from `dashboard/dist`

The VPS's system nginx config for `near2far.family` must proxy all traffic to the Docker dashboard container (port 5100), **not** serve static files from `dashboard/dist` on disk. Docker builds write compiled output inside the container image — they never touch the host filesystem. A system nginx config with `root /opt/ns.s/ns.s-near2far/dashboard/dist` will serve a permanently stale build regardless of how many times Docker is rebuilt or Cloudflare is purged.

Correct `/etc/nginx/sites-enabled/near2far.conf`:
```nginx
server {
    listen 80;
    listen [::]:80;
    server_name near2far.family;

    location / {
        proxy_pass http://127.0.0.1:5100;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }

    location /api {
        proxy_pass http://127.0.0.1:5101;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }

    location /uploads {
        proxy_pass http://127.0.0.1:5101;
        proxy_set_header Host $host;
    }

    location /ws {
        proxy_pass http://127.0.0.1:5101;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

All cache headers (`no-store` on `index.html`, `immutable` on `/assets/`) are set inside the Docker container's own nginx — the system nginx just proxies through.

### CSS gotcha: `backdrop-filter` and `position: fixed` (learned the hard way, twice)

`backdrop-filter` (used everywhere by the "liquid glass" look) makes its element the *containing
block* for any `position: fixed` descendant — a CSS spec quirk most people don't expect, since
`fixed` is supposed to mean "relative to the viewport." Bit us twice: `.sos-panel`'s fixed
911/contacts row collapsed into the panel's own small box, and separately `.tab-bar`'s
`backdrop-filter` collapsed the entire full-screen `.sos-panel` down to the tab bar's ~60px
height — because `SosButton` (which renders `.sos-panel`) is mounted as a DOM child of
`.tab-bar`, and `.setup-wizard` (wrapping `MemberEditModal`, also `position: fixed`) hit the same
thing. Fix: never put `backdrop-filter` directly on an element that has (or might gain) a
`position: fixed` descendant anywhere in its subtree — even a component you don't expect to be
there, like a modal. Put the blur on a `::before`/`::after` pseudo-element instead (see
`.tab-bar::before`, `.setup-wizard::before` in `dashboard/src/index.css`); a pseudo-element's own
`backdrop-filter` doesn't change what its *parent* is a containing block for.

### VPS deploy gotchas (learned the hard way)

- **There is exactly one `.env` file — the repo root one.** `backend/app/config.py` resolves it
  by an absolute path derived from the config module's own location, specifically so this can
  never happen again: a second `backend/.env` used to exist (pm2 runs the bare backend with
  `cwd=backend/`, and pydantic-settings' `env_file` used to be the relative string `".env"`,
  which silently resolved against that cwd instead of the repo root). That let the two files
  drift for weeks — anything added to the root `.env` (like the VAPID push keys) was invisible
  to the actual running process, with no error, just a value that looked "set" but wasn't. If
  you ever find a `backend/.env`, delete it — it shouldn't exist. The one value that's genuinely
  different between the bare VPS process and the local Docker stack (`POSTGRES_HOST`: `127.0.0.1`
  vs the Docker service name `db`) is handled as an explicit `environment:` override on the
  `backend` service in `docker-compose.yml`, not a second file.
- **`git pull` alone does nothing for the running backend.** `pm2` doesn't hot-reload — after
  pulling backend changes, you must `pm2 restart near2far` or the old code keeps running silently
  (symptom: a route that clearly exists in the code 404s with FastAPI's generic `{"detail":"Not
  Found"}`, meaning the route was never actually registered in the running process).
- **The dashboard is its own Docker container, not a bare `npm run build`.** `dashboard/Dockerfile`
  is a multi-stage build — `npm install && npm run build` happens *inside* the image build, and the
  result is baked into an nginx:alpine image; there's no host-side `dashboard/dist/` involved in
  production at all. Running `npm run build` on the VPS host builds nothing anyone serves.
  `pm2 restart near2far` only restarts the bare-host **backend** process — it has no effect on this
  container whatsoever. The actual deploy step is
  `docker compose build --no-cache --pull dashboard && docker compose up -d --no-deps dashboard`.
  `--no-cache --pull` matters: a cached `RUN npm run build` layer can silently reuse the *old*
  compiled output even after `git pull`'d source changes, with the build step reporting a
  suspiciously-fast "success" and the live bundle hash never changing. `--no-deps` matters even
  more: the dashboard service's `depends_on: [backend]` means a bare `up -d --build dashboard`
  tries to recreate the docker-compose `backend` service too — which is a separate, essentially
  vestigial container in production (real traffic is served by the bare pm2 process via the VPS's
  own system-level nginx, not through anything in this repo's docker-compose stack) that isn't
  normally running and can't rebuild/sync `uv` dependencies without outbound network access, which
  this host's container network doesn't reliably have. Letting compose touch it needlessly is how a
  routine dashboard deploy took the whole site down once already (see the nginx resolver note
  below).
- **The dashboard's nginx must not eagerly resolve `backend` at startup.** A static
  `proxy_pass http://backend:8000;` in `dashboard/nginx.conf` gets resolved once, when nginx's
  config loads — if the docker-compose `backend` container isn't up and healthy at that exact
  moment (see above: it usually isn't, in production), nginx refuses to start at all
  (`host not found in upstream "backend"`), crash-looping the *entire* dashboard container, not
  just the unused `/api` proxy path. Every `/api`-ish `location` block instead does
  `set $backend_upstream backend:8000; proxy_pass http://$backend_upstream;` with a
  `resolver 127.0.0.11 valid=10s;` (Docker's embedded DNS) at the server level — this defers
  resolution to request time, so a missing/unhealthy `backend` container just 502s those
  (in-production-unused) routes instead of taking the dashboard down.
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
  configurable emergency number needs `ALTER TABLE substrate.households ADD COLUMN IF NOT EXISTS
  emergency_number TEXT NOT NULL DEFAULT '911', ADD COLUMN IF NOT EXISTS emergency_label TEXT NOT
  NULL DEFAULT '911';` on an existing install. The SOS button needs `runtime.sos_alerts` on an
  existing install:
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
  The live/persisted action trail needs `runtime.sos_alert_actions` on an existing install:
  ```sql
  CREATE TABLE IF NOT EXISTS runtime.sos_alert_actions (
    id BIGSERIAL PRIMARY KEY,
    alert_id BIGINT NOT NULL REFERENCES runtime.sos_alerts(id) ON DELETE CASCADE,
    action_type TEXT NOT NULL,
    detail TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  ```
  The low-battery warning needs a `battery` column on `runtime.positions` on an existing install:
  `ALTER TABLE runtime.positions ADD COLUMN IF NOT EXISTS battery SMALLINT;`
  Place alerts need `substrate.places` on an existing install:
  ```sql
  CREATE TABLE IF NOT EXISTS substrate.places (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id UUID NOT NULL REFERENCES substrate.households(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    radius_m DOUBLE PRECISION NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  ```
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
    sort_order INT NOT NULL DEFAULT 0,
    notes TEXT
  );
  ```
  If `substrate.emergency_contacts` already exists from before `notes` was added:
  `ALTER TABLE substrate.emergency_contacts ADD COLUMN IF NOT EXISTS notes TEXT;`
  Community checkpoint reports need `runtime.checkpoint_reports` on an existing install:
  ```sql
  CREATE TABLE IF NOT EXISTS runtime.checkpoint_reports (
    id BIGSERIAL PRIMARY KEY,
    household_id UUID NOT NULL REFERENCES substrate.households(id) ON DELETE CASCADE,
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    note TEXT,
    reported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '2 hours'
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
  server.** The dashboard's `index.html` needs `no-store` in its Cache-Control header (`add_header
  Cache-Control "no-store, no-cache, must-revalidate";` in the nginx `location = /index.html` block) —
  `no-store` is required because Cloudflare (and CDN edges generally) ignore `no-cache` alone and
  cache the HTML at the edge anyway; `no-store` is what actually prevents edge caching. The `/assets/`
  nginx block adds `Cache-Control: public, max-age=31536000, immutable` so hashed asset bundles
  (`assets/index-<hash>.js/.css`) are cached aggressively by browsers and CDN edges — safe because
  the hash changes on every build. Without `no-store` on `index.html`, any CDN will serve a stale
  shell pointing at old bundle hashes to all clients indefinitely after a deploy, even when the
  server itself is current. An **installed PWA on iOS is worse** — it doesn't reliably recheck for a new page on
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

Most endpoints raise `HTTPException(400, str(e))` for validation failures — a plain string in
`detail`, which `dashboard/src/lib/api.ts`'s `unwrap()` surfaces directly. FastAPI's own built-in
422 responses (malformed request body, wrong field type) are the exception: `detail` there is an
array of `{msg, loc, ...}` objects, not a string — `unwrap()` detects and flattens that case too,
rather than throwing an unreadable stringified object.

The WebSocket handshake (`/ws/events`, proxied by nginx's `/ws` prefix match) and
`/api/traccar/forward` both carry a secret as a `?token=`
query param rather than a header — a WS upgrade can't send custom headers, and Traccar's
`forward.type=json` can't either. `dashboard/nginx.conf` disables `access_log` on both locations
specifically because nginx's default log format records the full request line (query string
included), which would otherwise write the admin password and `TRACCAR_FORWARD_TOKEN` into
container logs in plaintext on every request.

**Known gaps, not yet addressed** (security audit, 2026-08-24): the admin password has no
rate-limiting/lockout on repeated failed attempts, so it's brute-forceable at network-RTT speed
(PBKDF2 iteration cost is the only friction) by anything that can reach the API; there's no
password-rotation endpoint, so a suspected-compromised password can only be changed via direct
DB access; and the dashboard stores it in `localStorage` (not `sessionStorage`), so any future
XSS on the dashboard origin would yield a durable, silently-persisted credential leak. All three
are deliberately left as open design questions rather than a quick patch, since a real fix (rate
limiter, rotation flow, WS ticket scheme instead of a raw password in the URL) is a genuine
tradeoff discussion, not a mechanical change.

## Spec

Full product spec lives in the Knightsrook MCP knowledge base (`project:near2far:spec`, `project:near2far:funding`). See also [docs/architecture/overview.md](docs/architecture/overview.md) for the service-level architecture.

Note: the stored spec's trust-tier/redaction concept (intimate/named/ambient) was dropped during
implementation — decided it added complexity without a clear benefit for a family-safety tool, where
knowing someone's exact location is the point. The spec doc hasn't been updated to reflect this yet.
