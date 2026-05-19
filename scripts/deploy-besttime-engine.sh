#!/usr/bin/env bash
# ============================================================================
# venuu — deploy the BestTime live-data engine to Supabase
#
# Deploys two edge functions, sets the BestTime API key + a freshly
# generated CRON_SECRET as Supabase secrets, and prints the SQL the
# operator must paste to update system_config.cron_secret.
#
# Pre-flight: must be run from the repo root, with:
#   - .env containing BESTTIME_API_KEY_PRIVATE
#   - the supabase CLI installed and logged in (supabase login)
#   - migration 00013 already applied to the project
# ============================================================================

set -euo pipefail

PROJECT_REF="tyouvhtgzwcbqpylcssk"

GREEN='\033[1;32m'
CYAN='\033[1;36m'
YELLOW='\033[1;33m'
RED='\033[1;31m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

step() {
  echo ""
  echo -e "${CYAN}▶ $1${NC}"
}

ok() {
  echo -e "${GREEN}  ✓ $1${NC}"
}

fail() {
  echo -e "${RED}  ✗ $1${NC}" >&2
  exit 1
}

# ─── Pre-flight ────────────────────────────────────────────────
echo -e "${BOLD}venuu BestTime engine deploy${NC}"
echo -e "${DIM}project: $PROJECT_REF${NC}"

if [[ ! -f ".env" ]]; then
  fail "No .env in $(pwd). Run from repo root."
fi

if ! command -v supabase >/dev/null 2>&1; then
  fail "supabase CLI not found. Install: brew install supabase/tap/supabase"
fi

if ! supabase projects list >/dev/null 2>&1; then
  echo -e "${RED}  ✗ supabase CLI not authenticated.${NC}" >&2
  echo -e "${DIM}    Run: supabase login${NC}" >&2
  exit 1
fi

BESTTIME_KEY=$(grep '^BESTTIME_API_KEY_PRIVATE=' .env | cut -d= -f2- | tr -d '"' | tr -d "'")
if [[ -z "$BESTTIME_KEY" ]]; then
  fail "BESTTIME_API_KEY_PRIVATE missing from .env"
fi

ANON_KEY=$(grep '^VITE_SUPABASE_ANON_KEY=' .env | cut -d= -f2- | tr -d '"' | tr -d "'")
if [[ -z "$ANON_KEY" ]]; then
  fail "VITE_SUPABASE_ANON_KEY missing from .env"
fi

if ! command -v openssl >/dev/null 2>&1; then
  fail "openssl not found (needed to generate CRON_SECRET)"
fi

# ─── Step 1: Deploy refresh-besttime-live ──────────────────────
step "Step 1 — deploy refresh-besttime-live edge function"
supabase functions deploy refresh-besttime-live --project-ref "$PROJECT_REF"
ok "refresh-besttime-live deployed"

# ─── Step 2: Deploy besttime-health ────────────────────────────
step "Step 2 — deploy besttime-health edge function"
supabase functions deploy besttime-health --project-ref "$PROJECT_REF"
ok "besttime-health deployed"

# ─── Step 2.5: Deploy fuse-estimates ───────────────────────────
step "Step 2.5 — deploy fuse-estimates edge function"
supabase functions deploy fuse-estimates --project-ref "$PROJECT_REF"
ok "fuse-estimates deployed"

# ─── Step 3: Set BESTTIME_API_KEY_PRIVATE ──────────────────────
step "Step 3 — set BESTTIME_API_KEY_PRIVATE on Supabase"
supabase secrets set "BESTTIME_API_KEY_PRIVATE=$BESTTIME_KEY" --project-ref "$PROJECT_REF"
ok "BESTTIME_API_KEY_PRIVATE set"

# ─── Step 4: Generate + set CRON_SECRET ────────────────────────
step "Step 4 — generate CRON_SECRET and set on Supabase"
CRON_SECRET=$(openssl rand -hex 16)
supabase secrets set "CRON_SECRET=$CRON_SECRET" --project-ref "$PROJECT_REF"
ok "CRON_SECRET set on edge functions"

# ─── Step 5: Print success + manual SQL step ───────────────────
step "Step 5 — copy the SQL below and run it in the Supabase SQL editor"
echo ""
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}-- Sync cron_secret + supabase_anon_key into system_config so cron jobs auth correctly${NC}"
echo "UPDATE public.system_config SET value = '$CRON_SECRET', updated_at = now() WHERE key = 'cron_secret';"
echo "UPDATE public.system_config SET value = '$ANON_KEY',  updated_at = now() WHERE key = 'supabase_anon_key';"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

step "Test commands"
echo -e "${DIM}Health check (no auth):${NC}"
echo "  curl https://${PROJECT_REF}.supabase.co/functions/v1/besttime-health"
echo ""
echo -e "${DIM}Manual refresh (substitute the CRON_SECRET printed above):${NC}"
echo "  curl -X POST -H 'X-Cron-Secret: $CRON_SECRET' \\"
echo "    'https://${PROJECT_REF}.supabase.co/functions/v1/refresh-besttime-live?city=knoxville&chunk=0'"
echo ""
echo -e "${DIM}Manual fusion (calls the edge function path):${NC}"
echo "  curl -X POST -H 'X-Cron-Secret: $CRON_SECRET' \\"
echo "    -H \"Authorization: Bearer \$VITE_SUPABASE_ANON_KEY\" \\"
echo "    https://${PROJECT_REF}.supabase.co/functions/v1/fuse-estimates"
echo ""
echo -e "${DIM}Verify cron is scheduled (in SQL editor):${NC}"
echo "  SELECT jobname, schedule FROM cron.job WHERE jobname LIKE 'besttime-%' OR jobname = 'fuse-estimates';"
echo ""

ok "Deploy complete."
echo ""
echo -e "${YELLOW}⚠  Until you run the UPDATE above, cron jobs will return 401 (mismatched secret).${NC}"
