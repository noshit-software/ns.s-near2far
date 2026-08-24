#!/usr/bin/env bash
# Seeds the demo stack (docker-compose.demo.yml) with a fake household, members, emergency
# contacts, and positions — none of it real data. Safe to re-run: it wipes existing demo rows
# first. Requires the demo stack to already be up:
#   docker compose -p nss-near2far-demo -f docker-compose.demo.yml --env-file .env.demo up -d
set -euo pipefail
cd "$(dirname "$0")/.."

source .env.demo
API="http://localhost:${BACKEND_PORT}/api"
PASSWORD="demo-admin-pass"

echo "Wiping existing demo household (if any)..."
docker compose -p nss-near2far-demo -f docker-compose.demo.yml exec -T db \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "
    TRUNCATE runtime.positions, runtime.sos_alerts, substrate.emergency_contacts,
      substrate.members, substrate.households CASCADE;
  " >/dev/null

echo "Creating household..."
HOUSEHOLD=$(curl -s -X POST "$API/setup/household" -H "Content-Type: application/json" -d '{
  "name": "The Petersons",
  "admin_password": "'"$PASSWORD"'",
  "home_geofence": {"lat": 47.6062, "lng": -122.3321, "radius_m": 150}
}')
echo "$HOUSEHOLD"

echo "Creating members..."
DAD=$(curl -s -X POST "$API/setup/members" -H "Authorization: Bearer $PASSWORD" -H "Content-Type: application/json" -d '{
  "household_id": "'"$(echo "$HOUSEHOLD" | python3 -c "import json,sys;print(json.load(sys.stdin)['data']['id'])")"'",
  "display_name": "Dave"
}')
DAD_ID=$(echo "$DAD" | python3 -c "import json,sys;print(json.load(sys.stdin)['data']['id'])")

MOM=$(curl -s -X POST "$API/setup/members" -H "Authorization: Bearer $PASSWORD" -H "Content-Type: application/json" -d '{
  "household_id": "'"$(echo "$HOUSEHOLD" | python3 -c "import json,sys;print(json.load(sys.stdin)['data']['id'])")"'",
  "display_name": "Priya"
}')
MOM_ID=$(echo "$MOM" | python3 -c "import json,sys;print(json.load(sys.stdin)['data']['id'])")

KID=$(curl -s -X POST "$API/setup/members" -H "Authorization: Bearer $PASSWORD" -H "Content-Type: application/json" -d '{
  "household_id": "'"$(echo "$HOUSEHOLD" | python3 -c "import json,sys;print(json.load(sys.stdin)['data']['id'])")"'",
  "display_name": "Sam"
}')
KID_ID=$(echo "$KID" | python3 -c "import json,sys;print(json.load(sys.stdin)['data']['id'])")

echo "Adding emergency contacts..."
curl -s -X POST "$API/setup/emergency-contacts" -H "Authorization: Bearer $PASSWORD" -H "Content-Type: application/json" -d '{
  "name": "Grandma", "phone": "5551234567"
}' >/dev/null
curl -s -X POST "$API/setup/emergency-contacts" -H "Authorization: Bearer $PASSWORD" -H "Content-Type: application/json" -d '{
  "category": "car", "name": "AAA", "phone": "8004442222", "notes": "Member #DEMO12345"
}' >/dev/null

echo "Inserting fake positions..."
docker compose -p nss-near2far-demo -f docker-compose.demo.yml exec -T db \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "
    INSERT INTO runtime.positions (member_id, lat, lng, recorded_at) VALUES
      ('$DAD_ID', 47.6070, -122.3320, now()),
      ('$MOM_ID', 47.6055, -122.3400, now()),
      ('$KID_ID', 47.6100, -122.3280, now());
  " >/dev/null

echo
echo "Demo ready at http://localhost:${DASHBOARD_PORT} — admin password: $PASSWORD"
