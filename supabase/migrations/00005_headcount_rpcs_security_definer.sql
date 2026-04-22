-- ============================================================================
-- 00005_headcount_rpcs_security_definer.sql
-- HOTFIX — April 21, 2026, 9:21 PM
--
-- The RLS lockdown (00001) assumed the headcount RPCs bypassed table policies
-- via SECURITY DEFINER. They did not. From lockdown through emergency-revert,
-- every bouncer clicker write silently failed — UI applied optimistic counts
-- but insert/update hit RLS and rolled back.
--
-- Applied directly to production Supabase via SQL editor tonight to unblock
-- real venues. Committing the migration file to keep repo in sync with prod.
--
-- Note: target_city is character varying (not text) in the original signature.
-- ============================================================================

BEGIN;

ALTER FUNCTION public.increment_headcount(uuid, varchar, date, uuid)
  SECURITY DEFINER
  SET search_path = public, pg_temp;

ALTER FUNCTION public.decrement_headcount(uuid, varchar, date, uuid)
  SECURITY DEFINER
  SET search_path = public, pg_temp;

ALTER FUNCTION public.adjust_headcount(uuid, varchar, date, integer, uuid)
  SECURITY DEFINER
  SET search_path = public, pg_temp;

COMMIT;
