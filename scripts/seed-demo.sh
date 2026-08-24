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
AUTH=(-H "Authorization: Bearer $PASSWORD")

json_field() { python3 -c "import json,sys;print(json.load(sys.stdin)['data']['$1'])"; }

echo "Wiping existing demo household (if any)..."
docker compose -p nss-near2far-demo -f docker-compose.demo.yml exec -T db \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "
    TRUNCATE runtime.positions, runtime.sos_alerts, substrate.emergency_contacts,
      substrate.members, substrate.households CASCADE;
  " >/dev/null

echo "Creating household..."
HOUSEHOLD_ID=$(curl -s -X POST "$API/setup/household" -H "Content-Type: application/json" -d '{
  "name": "The Petersons",
  "admin_password": "'"$PASSWORD"'",
  "home_geofence": {"lat": 47.6062, "lng": -122.3321, "radius_m": 150}
}' | json_field id)

add_member() {
  curl -s -X POST "$API/setup/members" "${AUTH[@]}" -H "Content-Type: application/json" -d '{
    "household_id": "'"$HOUSEHOLD_ID"'",
    "display_name": "'"$1"'"
  }' | json_field id
}

echo "Creating members..."
DAVE_ID=$(add_member "Dave")
PRIYA_ID=$(add_member "Priya")
SAM_ID=$(add_member "Sam")
MAYA_ID=$(add_member "Maya")
GRANDPA_ID=$(add_member "Grandpa Joe")

add_contact() {
  local category_json="null"
  [ -n "$1" ] && category_json="\"$1\""
  local notes_json="null"
  [ -n "$4" ] && notes_json="\"$4\""
  curl -s -X POST "$API/setup/emergency-contacts" "${AUTH[@]}" -H "Content-Type: application/json" -d '{
    "category": '"$category_json"', "name": "'"$2"'", "phone": "'"$3"'", "notes": '"$notes_json"'
  }' >/dev/null
}

echo "Adding emergency contacts..."
# General (shown for every SOS category) — cap 2
add_contact "" "Grandma" "5551234567" ""
add_contact "" "Uncle Mike" "5559876543" ""
# Medical — cap 3
add_contact "medical" "Dr. Chen" "5552223333" "Family physician, Swedish Clinic"
add_contact "medical" "Poison Control" "8002221222" ""
add_contact "medical" "Pediatrician" "5554445566" "Dr. Osei, after-hours line"
# Authority threat (security) — cap 3
add_contact "security" "Family Lawyer" "5417912345" ""
add_contact "security" "Non-Emergency PD" "5553111000" ""
# Being followed (suspicious) — cap 3
add_contact "suspicious" "Neighborhood Watch" "5556781234" ""
add_contact "suspicious" "Aunt Rosa" "5559990011" "Lives 2 blocks away"
# Car trouble — cap 3
add_contact "car" "AAA" "8004442222" "Member #DEMO12345"
add_contact "car" "State Farm" "8005551212" "Policy #SF-9981-DEMO"
add_contact "car" "Joe's Towing" "5553214567" ""

echo "Inserting fake positions..."
docker compose -p nss-near2far-demo -f docker-compose.demo.yml exec -T db \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "
    INSERT INTO runtime.positions (member_id, lat, lng, recorded_at) VALUES
      ('$DAVE_ID', 47.6070, -122.3320, now()),
      ('$PRIYA_ID', 47.6055, -122.3400, now()),
      ('$SAM_ID', 47.6100, -122.3280, now()),
      ('$MAYA_ID', 47.6130, -122.3450, now() - interval '4 minutes'),
      ('$GRANDPA_ID', 47.5990, -122.3350, now() - interval '20 minutes');
  " >/dev/null

echo
echo "Demo ready at http://localhost:${DASHBOARD_PORT} — admin password: $PASSWORD"
