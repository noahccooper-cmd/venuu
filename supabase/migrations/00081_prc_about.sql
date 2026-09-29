-- ═══════════════════════════════════════════════════════════════════
-- 00081_prc_about.sql — Pinellas Run Club's About copy (run after 00077).
--
-- Adds the club's line ahead of its schedule. Only touches the row while
-- `about` still holds the 00077 seed value, so it never overwrites an
-- admin edit and re-running changes nothing.
-- ═══════════════════════════════════════════════════════════════════

UPDATE public.brands
SET about = 'All paces welcome. No sign-up needed. Better together. Thursday evenings · Saturday mornings'
WHERE slug = 'pinellas_run_club'
  AND about = 'Thursday evenings · Saturday mornings';
