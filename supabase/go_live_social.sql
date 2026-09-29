-- ═══════════════════════════════════════════════════════════════════
-- go_live_social.sql — NOT a migration. Run once in the SQL editor on the
-- day the new App Store build (with the Tonight surface filter) is live.
--
-- Activates the 8 date-TBA pop-ups seeded inactive by 00077. Targets the
-- fixed seed ids only; safe to re-run.
-- ═══════════════════════════════════════════════════════════════════

UPDATE public.events
SET is_active = true
WHERE id IN (
  '5c077000-0000-4000-8000-000000000001',
  '5c077000-0000-4000-8000-000000000002',
  '5c077000-0000-4000-8000-000000000003',
  '5c077000-0000-4000-8000-000000000004',
  '5c077000-0000-4000-8000-000000000005',
  '5c077000-0000-4000-8000-000000000006',
  '5c077000-0000-4000-8000-000000000007',
  '5c077000-0000-4000-8000-000000000008'
)
AND created_by = 'seed:00077';

-- Check: expect 8 rows, all active.
SELECT id, title, city, is_active, verification
FROM public.events
WHERE created_by = 'seed:00077'
ORDER BY id;
