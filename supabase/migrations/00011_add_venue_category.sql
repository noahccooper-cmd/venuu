-- ═══════════════════════════════════════════════════════════════
-- 00011_add_venue_category.sql
-- Adds a `category` column to venues and classifies the 15 known
-- Greek-letter (frat) venues as 'greek' so the BestTime pull
-- script can permanently skip them.
-- Idempotent.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS category text;

CREATE INDEX IF NOT EXISTS idx_venues_category
  ON public.venues (category)
  WHERE category IS NOT NULL;

UPDATE public.venues SET category = 'greek'
WHERE name IN ('ΛΧΑ', 'ΒΘΠ', 'ΑΓΡ', 'FIJI', 'ΦΚΤ', 'ΠΚΦ', 'ΣΝ',
               'ΠΚΑ', 'ΣΧ', 'BYX', 'ΣΑΕ', 'ΦΚΨ', 'ΦΣΚ', 'ΚΣ')
   OR slug LIKE '%-frat-%'
   OR slug LIKE 'lambda-%'
   OR slug LIKE 'beta-%'
   OR slug LIKE 'sigma-%'
   OR slug LIKE 'kappa-%'
   OR slug LIKE 'phi-%'
   OR slug LIKE 'pi-%'
   OR slug LIKE 'alpha-%'
   OR slug LIKE 'fiji%';

DO $$
DECLARE
  greek_count int;
BEGIN
  SELECT COUNT(*) INTO greek_count FROM public.venues WHERE category = 'greek';
  RAISE NOTICE '═══ Migration 00011 complete ═══';
  RAISE NOTICE '  Venues classified as ''greek'': %', greek_count;
END $$;

COMMIT;
