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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS runtime.positions (
  id BIGSERIAL PRIMARY KEY,
  member_id UUID NOT NULL REFERENCES substrate.members(id),
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
