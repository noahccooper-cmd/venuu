-- 00062_featured_venue_rotation.sql
-- Featured venue rotation for Tampa launch prep:
-- - Demote LunaVerse (was demo featured)
-- - Promote Sunspot, The Bookstore (knoxville flagships)
-- - Confirm M. Bird (tampa, already featured, add label)
-- - Promote Good Night John Boy (st_petersburg flagship)

-- Demote LunaVerse
UPDATE public.venues
SET featured = false, featured_label = NULL
WHERE name = 'LunaVerse';

-- Promote Sunspot (knoxville)
UPDATE public.venues
SET featured = true, featured_label = 'KNOXVILLE FLAGSHIP'
WHERE name = 'Sunspot' AND city = 'knoxville';

-- Promote The Bookstore (knoxville)
UPDATE public.venues
SET featured = true, featured_label = 'KNOXVILLE PARTNER'
WHERE name = 'The Bookstore' AND city = 'knoxville';

-- Update M. Bird label (already featured)
UPDATE public.venues
SET featured = true, featured_label = 'TAMPA FLAGSHIP'
WHERE name = 'M. Bird' AND city = 'tampa';

-- Promote Good Night John Boy (st_petersburg)
UPDATE public.venues
SET featured = true, featured_label = 'ST PETE FLAGSHIP'
WHERE name = 'Good Night John Boy' AND city = 'st_petersburg';

-- Verify (visible in supabase logs)
-- SELECT name, city, featured, featured_label FROM venues WHERE featured = true ORDER BY city, name;
