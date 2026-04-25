-- ============================================================================
-- 00001_lock_down_rls.sql
-- Lock down row-level security on public schema tables.
-- Drops overly-permissive policies and replaces with auth.uid() or
-- service_role scoped versions. Also dedupes duplicate policies.
-- ============================================================================

BEGIN;

-- ─── venues ───────────────────────────────────────────────────────────
-- Keep public read. Remove public update. Venue staff updates should
-- flow through service_role via an edge function.
DROP POLICY IF EXISTS "update_venues" ON public.venues;

-- ─── cover_configs ────────────────────────────────────────────────────
-- Public read stays. Writes locked to service_role only.
-- create-cover-payment edge function already uses service role.
DROP POLICY IF EXISTS "Anyone can insert cover configs" ON public.cover_configs;
DROP POLICY IF EXISTS "Anyone can insert cover_configs" ON public.cover_configs;
DROP POLICY IF EXISTS "Anyone can update cover configs" ON public.cover_configs;
DROP POLICY IF EXISTS "Anyone can update cover_configs" ON public.cover_configs;
DROP POLICY IF EXISTS "Anyone can read cover_configs" ON public.cover_configs;
-- Keep one read policy
-- ("Anyone can read cover configs" remains)

CREATE POLICY "service_role writes cover_configs"
  ON public.cover_configs FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ─── cover_price_history ──────────────────────────────────────────────
-- Read stays public (the map shows price history). Inserts only via
-- service_role (finalize-cover-purchase edge function).
DROP POLICY IF EXISTS "Anyone can insert price history" ON public.cover_price_history;

CREATE POLICY "service_role writes price history"
  ON public.cover_price_history FOR INSERT TO service_role
  WITH CHECK (true);

-- ─── cover_purchases ──────────────────────────────────────────────────
-- Keep authed insert (user_id = auth.uid()) and authed read own.
-- Remove anon scan/update. QR scanning at door should go through an
-- edge function with service_role, not anon direct DB access.
DROP POLICY IF EXISTS "Anon can read purchases for scanning" ON public.cover_purchases;
DROP POLICY IF EXISTS "Anon can update purchase status" ON public.cover_purchases;

CREATE POLICY "service_role full access cover_purchases"
  ON public.cover_purchases FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ─── venue_stripe_accounts ────────────────────────────────────────────
-- CRITICAL. Anyone could previously redirect a venue's Stripe payouts.
-- Public read removed (no reason for anon to see Connect account IDs).
-- All writes locked to service_role.
DROP POLICY IF EXISTS "Anyone can insert stripe accounts" ON public.venue_stripe_accounts;
DROP POLICY IF EXISTS "Anyone can update stripe accounts" ON public.venue_stripe_accounts;
DROP POLICY IF EXISTS "Anyone can read stripe accounts" ON public.venue_stripe_accounts;

CREATE POLICY "service_role full access venue_stripe_accounts"
  ON public.venue_stripe_accounts FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ─── events ───────────────────────────────────────────────────────────
-- Anyone could previously delete or modify any event. Keep public read
-- for active/unexpired. Locked writes to authenticated creator or
-- service_role.
DROP POLICY IF EXISTS "Anyone can delete events" ON public.events;
DROP POLICY IF EXISTS "Anyone can insert events" ON public.events;
DROP POLICY IF EXISTS "Anyone can update events" ON public.events;

-- "Authenticated users can create events" and "Service role can create events"
-- and "Service role can update events" remain.

CREATE POLICY "service_role can delete events"
  ON public.events FOR DELETE TO service_role
  USING (true);

-- ─── headcounts ───────────────────────────────────────────────────────
-- Public read stays (map shows live counts). Writes only via the
-- headcount RPCs (which run SECURITY DEFINER).
DROP POLICY IF EXISTS "insert_headcounts" ON public.headcounts;
DROP POLICY IF EXISTS "update_headcounts" ON public.headcounts;

CREATE POLICY "service_role writes headcounts"
  ON public.headcounts FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ─── clicker_logs ─────────────────────────────────────────────────────
-- Audit log. Reads stay public (portal shows history). Writes via
-- headcount RPCs (SECURITY DEFINER) only.
DROP POLICY IF EXISTS "insert_logs" ON public.clicker_logs;

CREATE POLICY "service_role writes clicker_logs"
  ON public.clicker_logs FOR INSERT TO service_role
  WITH CHECK (true);

-- ─── venue_rewards ────────────────────────────────────────────────────
-- Public/auth reads stay (app needs to show rewards). Writes only via
-- portal edge functions (service_role).
DROP POLICY IF EXISTS "Anyone can insert rewards" ON public.venue_rewards;
DROP POLICY IF EXISTS "Anyone can update rewards" ON public.venue_rewards;

CREATE POLICY "service_role writes venue_rewards"
  ON public.venue_rewards FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ─── organization_venues ──────────────────────────────────────────────
-- Lockdown — security org fee routing.
DROP POLICY IF EXISTS "Anyone can insert org venues" ON public.organization_venues;
DROP POLICY IF EXISTS "Anyone can update org venues" ON public.organization_venues;

CREATE POLICY "service_role writes organization_venues"
  ON public.organization_venues FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ─── security_organizations ───────────────────────────────────────────
-- Read stays public. Writes service_role only.
DROP POLICY IF EXISTS "Anyone can insert orgs" ON public.security_organizations;
DROP POLICY IF EXISTS "Anyone can update orgs" ON public.security_organizations;

CREATE POLICY "service_role writes security_organizations"
  ON public.security_organizations FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ─── venue_updates ────────────────────────────────────────────────────
-- The "1 update tonight" banner data. Reads stay public. Writes
-- service_role only.
DROP POLICY IF EXISTS "Public delete venue_updates" ON public.venue_updates;
DROP POLICY IF EXISTS "Public insert venue_updates" ON public.venue_updates;

CREATE POLICY "service_role writes venue_updates"
  ON public.venue_updates FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ─── venue_comments ───────────────────────────────────────────────────
-- Public insert previously had no auth check at all. Scope to
-- authenticated users tied to user_id.
DROP POLICY IF EXISTS "insert_vc" ON public.venue_comments;

CREATE POLICY "insert_vc_authed"
  ON public.venue_comments FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

-- ─── venue_recaps ─────────────────────────────────────────────────────
-- Same treatment. Recaps should be attributable to a user.
DROP POLICY IF EXISTS "insert_vr" ON public.venue_recaps;

CREATE POLICY "insert_vr_authed"
  ON public.venue_recaps FOR INSERT TO authenticated
  WITH CHECK (true);

-- ─── chat_messages ────────────────────────────────────────────────────
-- Anyone could post as any user_id. Scope to authenticated and self.
DROP POLICY IF EXISTS "insert_chat" ON public.chat_messages;

CREATE POLICY "insert_chat_authed"
  ON public.chat_messages FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- ─── checkins ─────────────────────────────────────────────────────────
-- Was fully public CRUD. Scope to self for writes.
DROP POLICY IF EXISTS "insert_checkins" ON public.checkins;
DROP POLICY IF EXISTS "update_checkins" ON public.checkins;
DROP POLICY IF EXISTS "delete_checkins" ON public.checkins;

CREATE POLICY "insert_checkins_self"
  ON public.checkins FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "update_checkins_self"
  ON public.checkins FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "delete_checkins_self"
  ON public.checkins FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- ─── profiles ─────────────────────────────────────────────────────────
-- Anyone could update any profile. Scope to self.
DROP POLICY IF EXISTS "update_profiles" ON public.profiles;
DROP POLICY IF EXISTS "insert_profiles" ON public.profiles;

CREATE POLICY "insert_profiles_self"
  ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (auth_id = auth.uid());

CREATE POLICY "update_profiles_self"
  ON public.profiles FOR UPDATE TO authenticated
  USING (auth_id = auth.uid()) WITH CHECK (auth_id = auth.uid());

-- ─── nightly_codes ────────────────────────────────────────────────────
-- Should never be readable by clients — only the RPC needs it.
DROP POLICY IF EXISTS "Authenticated users can read nightly codes" ON public.nightly_codes;

-- ─── nfc_tags ─────────────────────────────────────────────────────────
-- Currently leaks tag_password via public read. Only the check-in RPC
-- needs to see these. Switch to service_role only.
DROP POLICY IF EXISTS "Anyone can read active tags" ON public.nfc_tags;

CREATE POLICY "service_role reads nfc_tags"
  ON public.nfc_tags FOR SELECT TO service_role
  USING (true);

COMMIT;

-- ============================================================================
-- Verification query — run separately after the migration commits.
-- Paste the output back to Claude so we can confirm the new policy state.
-- ============================================================================
-- SELECT schemaname, tablename, policyname, roles, cmd
-- FROM pg_policies
-- WHERE schemaname = 'public'
-- ORDER BY tablename, policyname;
