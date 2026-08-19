-- near2far schema
--
-- substrate: persistent reference data (households, members). Survives db:reset.
-- runtime: ephemeral working state (positions, live sessions, alert queues). Dropped/recreated by db:reset.

CREATE SCHEMA IF NOT EXISTS substrate;
CREATE SCHEMA IF NOT EXISTS runtime;

CREATE TABLE IF NOT EXISTS substrate.households (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  home_geofence JSONB,
  admin_password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS substrate.members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES substrate.households(id),
  display_name TEXT NOT NULL,
  -- Identifier tying this member to a position-reporting device — currently only
  -- Traccar (matched against its device `uniqueId`, see /api/traccar/forward), but
  -- source-agnostic so other adapters (e.g. Overland) can key off it too.
  device_id TEXT UNIQUE,
  -- Filename under the backend's uploads/avatars/ dir (served at /uploads/avatars/<value>),
  -- not a full URL, so it stays valid across domain/deploy changes. NULL until the member
  -- uploads a real photo — until then, the map falls back to a generated avatar_seed icon.
  avatar_filename TEXT,
  -- Seed for a locally-generated placeholder avatar (dashboard renders it via @dicebear, no
  -- network calls). Randomly assigned at creation; the member can reroll it in Settings.
  avatar_seed TEXT NOT NULL DEFAULT substr(md5(random()::text || clock_timestamp()::text), 1, 10),
  -- User-chosen map marker color (hex, e.g. "#5b8cff"). NULL falls back to a color hashed
  -- deterministically from the member's id (see dashboard's lib/avatar.ts memberColor).
  color TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS runtime.positions (
  id BIGSERIAL PRIMARY KEY,
  member_id UUID NOT NULL REFERENCES substrate.members(id) ON DELETE CASCADE,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Web Push subscriptions for the household's dashboard (browser push, e.g. trip-end alerts).
-- Household-wide, not per-member: whoever has the dashboard unlocked on a given browser
-- subscribes that browser, matching the single shared-admin-password auth model.
CREATE TABLE IF NOT EXISTS substrate.push_subscriptions (
  id BIGSERIAL PRIMARY KEY,
  household_id UUID NOT NULL REFERENCES substrate.households(id),
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Panic-button alerts. Not tied to a specific member — the shared admin password model has
-- no per-member login, so an SOS is "someone on this household's device" rather than
-- attributed to a member identity. Kept in runtime (not substrate) since these are
-- time-bound incidents, not durable reference data.
CREATE TABLE IF NOT EXISTS runtime.sos_alerts (
  id BIGSERIAL PRIMARY KEY,
  household_id UUID NOT NULL REFERENCES substrate.households(id),
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  address TEXT,
  category TEXT NOT NULL DEFAULT 'general',
  origin_client_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_at TIMESTAMPTZ
);

-- One-tap emergency dial targets shown on the SOS button alongside 911. `category` NULL means
-- "general" — shown regardless of which SOS category is selected (e.g. a spouse, a lawyer).
-- A non-null category (matching sos_alerts.category) only shows once that category is engaged
-- — e.g. 'car' contacts (AAA, insurance, non-emergency police) are only relevant for car
-- trouble, not a medical emergency. App-enforced caps: 2 general, 3 per category.
CREATE TABLE IF NOT EXISTS substrate.emergency_contacts (
  id BIGSERIAL PRIMARY KEY,
  household_id UUID NOT NULL REFERENCES substrate.households(id),
  category TEXT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0
);
