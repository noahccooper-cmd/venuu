#!/usr/bin/env bash
# ============================================================================
# venuu push — send a push notification to a venue's city audience
# Usage:   ./scripts/push.sh
# ============================================================================

set -euo pipefail

MAGENTA='\033[1;35m'
CYAN='\033[1;36m'
GREEN='\033[1;32m'
YELLOW='\033[1;33m'
RED='\033[1;31m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

if [[ ! -f ".env" ]]; then
  echo -e "${RED}✗ No .env found in $(pwd)${NC}"
  echo -e "${DIM}  Run this script from the venuu repo root (~/Desktop/venuu).${NC}"
  exit 1
fi

ANON_KEY=$(grep '^VITE_SUPABASE_ANON_KEY=' .env | cut -d= -f2- | tr -d '"' | tr -d "'")
SUPABASE_URL=$(grep '^VITE_SUPABASE_URL=' .env | cut -d= -f2- | tr -d '"' | tr -d "'")

if [[ -z "$ANON_KEY" ]]; then
  echo -e "${RED}✗ VITE_SUPABASE_ANON_KEY is empty in .env${NC}"
  exit 1
fi

if [[ -z "$SUPABASE_URL" ]]; then
  echo -e "${RED}✗ VITE_SUPABASE_URL is empty in .env${NC}"
  exit 1
fi

SUPABASE_URL="${SUPABASE_URL%/}"

echo ""
echo -e "${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}  venuu push${NC}  ${DIM}—  send a push to a venue's city${NC}"
echo -e "${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

read -r -p "$(echo -e "${CYAN}Venue slug${NC} ${DIM}(e.g. literboard, sunspot, cool-beans)${NC}: ")" SLUG

if [[ -z "$SLUG" ]]; then
  echo -e "${RED}✗ Empty slug. Exiting.${NC}"
  exit 1
fi

echo ""
echo -e "${DIM}Looking up '${SLUG}'...${NC}"

VENUE_JSON=$(curl -s -X GET \
  "${SUPABASE_URL}/rest/v1/venues?slug=eq.${SLUG}&select=id,name,slug,city,is_active" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $ANON_KEY")

VENUE_ID=$(echo "$VENUE_JSON" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
VENUE_NAME=$(echo "$VENUE_JSON" | grep -o '"name":"[^"]*"' | head -1 | cut -d'"' -f4)
VENUE_CITY=$(echo "$VENUE_JSON" | grep -o '"city":"[^"]*"' | head -1 | cut -d'"' -f4)
VENUE_ACTIVE=$(echo "$VENUE_JSON" | grep -o '"is_active":[^,}]*' | head -1 | cut -d: -f2)

if [[ -z "$VENUE_ID" ]]; then
  echo -e "${RED}✗ No venue found with slug '${SLUG}'${NC}"
  echo ""
  echo -e "${DIM}Available Knoxville venues:${NC}"
  curl -s -X GET \
    "${SUPABASE_URL}/rest/v1/venues?city=eq.Knoxville,%20TN&select=slug,name&is_active=eq.true&order=name" \
    -H "apikey: $ANON_KEY" \
    -H "Authorization: Bearer $ANON_KEY" \
    | grep -o '"slug":"[^"]*","name":"[^"]*"' \
    | sed 's/"slug":"//; s/","name":"/  —  /; s/"$//' \
    | sed 's/^/  /'
  echo ""
  exit 1
fi

if [[ "$VENUE_ACTIVE" != "true" ]]; then
  echo -e "${YELLOW}⚠ Venue '${VENUE_NAME}' is not active. Continue anyway? [y/N]${NC}"
  read -r CONFIRM
  if [[ ! "$CONFIRM" =~ ^[yY]$ ]]; then
    echo -e "${DIM}Aborted.${NC}"
    exit 0
  fi
fi

echo -e "${GREEN}✓${NC} ${BOLD}${VENUE_NAME}${NC} ${DIM}(${VENUE_CITY})${NC}"

echo ""
echo -e "${CYAN}Message${NC} ${DIM}(this is what the notification will say — keep it short)${NC}:"
read -r MESSAGE

if [[ -z "$MESSAGE" ]]; then
  echo -e "${RED}✗ Empty message. Exiting.${NC}"
  exit 1
fi

MESSAGE_LEN=${#MESSAGE}
if [[ $MESSAGE_LEN -gt 180 ]]; then
  echo -e "${YELLOW}⚠ Message is ${MESSAGE_LEN} chars — iOS may truncate after ~120. Continue? [y/N]${NC}"
  read -r CONFIRM
  if [[ ! "$CONFIRM" =~ ^[yY]$ ]]; then
    echo -e "${DIM}Aborted.${NC}"
    exit 0
  fi
fi

echo ""
echo -e "${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}  Preview${NC}"
echo -e "${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${DIM}  Venue:${NC}   ${BOLD}${VENUE_NAME}${NC}"
echo -e "${DIM}  City:${NC}    ${VENUE_CITY}"
echo -e "${DIM}  Length:${NC}  ${MESSAGE_LEN} chars"
echo ""
echo -e "${DIM}  Notification body:${NC}"
echo -e "  ${CYAN}\"${MESSAGE}\"${NC}"
echo ""
echo -e "${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

read -r -p "$(echo -e "${YELLOW}Send to all ${VENUE_CITY} users? [y/N]${NC}: ")" CONFIRM

if [[ ! "$CONFIRM" =~ ^[yY]$ ]]; then
  echo -e "${DIM}Aborted. Nothing sent.${NC}"
  exit 0
fi

echo ""
echo -e "${DIM}Firing...${NC}"

CITY_NORMALIZED=$(echo "$VENUE_CITY" | tr '[:upper:]' '[:lower:]' | sed 's/,.*//' | tr -d ' ')
DROP_ID="${SLUG}-$(date +%Y%m%d-%H%M%S)"
MESSAGE_JSON=$(python3 -c "import json, sys; print(json.dumps(sys.argv[1]))" "$MESSAGE")

PAYLOAD=$(cat <<PAYLOAD_END
{
  "venue_id": "${VENUE_ID}",
  "venue_name": "${VENUE_NAME}",
  "drop_text": ${MESSAGE_JSON},
  "drop_id": "${DROP_ID}",
  "city": "${CITY_NORMALIZED}"
}
PAYLOAD_END
)

RESPONSE=$(curl -s -X POST \
  "${SUPABASE_URL}/functions/v1/push-drop" \
  -H "Content-Type: application/json" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $ANON_KEY" \
  -d "$PAYLOAD")

SUCCESS=$(echo "$RESPONSE" | grep -o '"success":[^,}]*' | head -1 | cut -d: -f2)
SENT=$(echo "$RESPONSE" | grep -o '"sent":[0-9]*' | head -1 | cut -d: -f2)
FAILED=$(echo "$RESPONSE" | grep -o '"failed":[0-9]*' | head -1 | cut -d: -f2)
TOTAL=$(echo "$RESPONSE" | grep -o '"total":[0-9]*' | head -1 | cut -d: -f2)

echo ""

if [[ "$SUCCESS" == "true" ]]; then
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${GREEN}  ✓ Sent.${NC}"
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
  echo -e "  ${BOLD}${SENT}${NC} delivered  ·  ${DIM}${FAILED} failed  ·  ${TOTAL} total${NC}"
  echo -e "  ${DIM}drop_id: ${DROP_ID}${NC}"
  echo ""
  if [[ -n "$FAILED" && "$FAILED" -gt 0 ]]; then
    echo -e "${DIM}  Note: ${FAILED} failed tokens are usually uninstalled apps (normal churn).${NC}"
    echo ""
  fi
else
  echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${RED}  ✗ Failed.${NC}"
  echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
  echo -e "${DIM}Response:${NC}"
  echo "$RESPONSE" | head -c 500
  echo ""
  echo ""
  exit 1
fi
