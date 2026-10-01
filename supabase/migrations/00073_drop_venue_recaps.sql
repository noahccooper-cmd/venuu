-- ═══════════════════════════════════════════════════════════════
-- 00073_drop_venue_recaps.sql
--
-- DRAFT — Step (e), part 1. Must apply AFTER 00070/00072 (the view
-- rewrites) AND after the app-code fixes deployed in this same pass
-- (supabase/functions/venny-chat/index.ts, src/hooks/useUserAccountStats.ts,
-- src/hooks/useVenuuRank.ts, src/components/Portal/ClickerView.tsx —
-- all confirmed to no longer reference venue_recaps as of this draft).
--
-- Drops venue_recaps and its two RPCs:
--
--   • submit_moment(uuid, text, text, integer) RETURNS venue_recaps
--     — inserts into venue_recaps directly. Its return type IS
--     venue_recaps's row type, so it must be dropped before (or with
--     CASCADE alongside) the table.
--
--   • record_paint(uuid, integer, timestamptz, uuid DEFAULT NULL)
--     — grouped with this drop per instruction, but flagging an
--     important distinction: record_paint does NOT reference
--     venue_recaps at all. Its body inserts into vibe_ratings and
--     updates paint_prompts — a completely different table, not in
--     scope for any drop today. Dropping it here is safe (nothing
--     in the app calls it — its only caller, useMomentSubmit.ts, was
--     deleted in the Moments removal), but it leaves vibe_ratings as
--     a table with zero remaining writers (its one realtime reader,
--     useVibeCanvasPoints.ts, was already found dead and deleted in
--     an earlier sweep). vibe_ratings itself is NOT dropped by this
--     migration — you didn't name it, and it's a candidate for its
--     own separate look, not bundled in here.
--
-- Confirmed via docs/prod-schema-snapshot.sql: no FK constraints
-- reference venue_recaps (it's a leaf table — nothing points TO it).
-- Its own outbound FKs (user_id -> auth.users, venue_id -> venues),
-- indexes, RLS policies, and realtime publication membership are all
-- dropped automatically as part of DROP TABLE — no separate cleanup
-- needed for those.
--
-- DRAFT ONLY. Not applied. Review before running `supabase db push`.
-- Restore point: PITR to any timestamp before this runs (confirmed
-- available back to 2026-08-10 as of this draft).
-- ═══════════════════════════════════════════════════════════════

BEGIN;

DROP FUNCTION IF EXISTS public.submit_moment(uuid, text, text, integer);
DROP FUNCTION IF EXISTS public.record_paint(uuid, integer, timestamp with time zone, uuid);

DROP TABLE IF EXISTS public.venue_recaps;

DO $$
BEGIN
  RAISE NOTICE '-----------------------------------';
  RAISE NOTICE 'venue_recaps dropped (00073), along with submit_moment() and record_paint()';
  RAISE NOTICE '  record_paint did not reference venue_recaps — grouped per instruction, wrote to vibe_ratings';
  RAISE NOTICE '  vibe_ratings NOT dropped — now has zero writers, flagged as a future candidate, not touched here';
  RAISE NOTICE '  app-code + view fixes for this drop were confirmed BEFORE this migration was drafted';
  RAISE NOTICE '-----------------------------------';
END $$;

COMMIT;
