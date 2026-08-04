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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS runtime.positions (
  id BIGSERIAL PRIMARY KEY,
  member_id UUID NOT NULL REFERENCES substrate.members(id),
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
