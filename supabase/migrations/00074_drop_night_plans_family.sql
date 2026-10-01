-- ═══════════════════════════════════════════════════════════════
-- 00074_drop_night_plans_family.sql
--
-- DRAFT — Step (e), part 2. Apply AFTER 00073 (independent of it —
-- venue_recaps and night_plans don't reference each other — but
-- keeping them as separate migrations/checkpoints per your request
-- to apply one at a time). Also depends on the same app-code fixes
-- as 00073 (venny-chat, useUserAccountStats.ts, useVenuuRank.ts —
-- all confirmed to no longer query night_plans/stop_ratings/
-- night_ratings as of this draft).
--
-- Drops three tables together in one statement:
--
--   • night_plans     — the plan itself (stops jsonb, status, etc.)
--   • night_ratings    — FK night_ratings.plan_id -> night_plans.id
--                         ON DELETE CASCADE (data-level only —
--                         row deletes cascade, but a DROP TABLE on
--                         night_plans would NOT drop this table on
--                         its own, only the FK constraint. Naming it
--                         explicitly here is what actually removes it.)
--   • stop_ratings     — same story: FK stop_ratings.plan_id ->
--                         night_plans.id ON DELETE CASCADE. Also has
--                         its own FKs to profiles and venues
--                         (outbound — not a concern for this drop).
--
-- All three are named explicitly in one DROP TABLE statement so
-- Postgres resolves the FK ordering internally — no manual ordering
-- or CASCADE needed beyond what's already implied by naming all
-- three. (A plain `DROP TABLE night_plans CASCADE` alone would only
-- have dropped the two FK *constraints*, leaving night_ratings and
-- stop_ratings behind as orphaned empty-FK tables — that's why all
-- three are named here instead.)
--
-- Confirmed via docs/prod-schema-snapshot.sql: no triggers on any of
-- the three; no functions besides the ones already handled in venny-chat
-- (buildUserMemoryBlock, tool_search_venues — both fixed in this pass)
-- and the DB-side user_account_stats view (fixed in 00070) reference
-- them. Indexes, RLS policies, and grants on all three are dropped
-- automatically with their tables.
--
-- DRAFT ONLY. Not applied. Review before running `supabase db push`.
-- Restore point: PITR to any timestamp before this runs (confirmed
-- available back to 2026-08-10 as of this draft).
-- ═══════════════════════════════════════════════════════════════

BEGIN;

DROP TABLE IF EXISTS public.stop_ratings, public.night_ratings, public.night_plans;

DO $$
BEGIN
  RAISE NOTICE '-----------------------------------';
  RAISE NOTICE 'night_plans, night_ratings, stop_ratings dropped together (00074)';
  RAISE NOTICE '  all three named explicitly — FK-dependent tables do not auto-drop with CASCADE alone';
  RAISE NOTICE '  app-code + view fixes for this drop were confirmed BEFORE this migration was drafted';
  RAISE NOTICE '-----------------------------------';
END $$;

COMMIT;
