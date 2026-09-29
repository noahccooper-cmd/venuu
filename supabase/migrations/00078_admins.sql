-- ═══════════════════════════════════════════════════════════════════
-- 00078_admins.sql — grant Venuu admins (run AFTER 00077).
--
-- Never guesses. Each grant only happens on EXACTLY ONE match; otherwise
-- it changes nothing and prints the candidates (NOTICE) so you can pick.
--
--   1. Mike — the profile named "Mr. Venuu". Matched on every name-like
--      column of profiles (username, display_name), normalized to letters
--      and digits so "Mr. Venuu", "mr_venuu", "MrVenuu" all match.
--   2. Noah — by auth email noahccooper@colaii.tech (the repo's git
--      author email), joined via profiles.auth_id → auth.users.id.
--
-- Run in the SQL editor (it bypasses the role-change guard, which only
-- polices app requests). Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════

DO $$
DECLARE
  n int;
  r record;
BEGIN
  -- ── 1. Mr. Venuu ─────────────────────────────────────────────────
  SELECT count(*) INTO n FROM public.profiles
  WHERE lower(regexp_replace(coalesce(username, ''), '[^a-zA-Z0-9]', '', 'g')) = 'mrvenuu'
     OR lower(regexp_replace(coalesce(display_name, ''), '[^a-zA-Z0-9]', '', 'g')) = 'mrvenuu';

  IF n = 1 THEN
    UPDATE public.profiles SET role = 'admin'
    WHERE lower(regexp_replace(coalesce(username, ''), '[^a-zA-Z0-9]', '', 'g')) = 'mrvenuu'
       OR lower(regexp_replace(coalesce(display_name, ''), '[^a-zA-Z0-9]', '', 'g')) = 'mrvenuu';
    RAISE NOTICE 'Mr. Venuu: granted admin (1 match).';
  ELSE
    RAISE NOTICE 'Mr. Venuu: % exact matches — NOT granted. Candidates containing "venuu":', n;
    FOR r IN
      SELECT id, username, display_name, email FROM public.profiles
      WHERE username ILIKE '%venuu%' OR display_name ILIKE '%venuu%'
      ORDER BY created_at
    LOOP
      RAISE NOTICE '  id=% username=% display_name=% email=%', r.id, r.username, r.display_name, r.email;
    END LOOP;
  END IF;

  -- ── 2. Noah ──────────────────────────────────────────────────────
  SELECT count(*) INTO n FROM public.profiles p
  JOIN auth.users u ON u.id = p.auth_id
  WHERE lower(u.email) = 'noahccooper@colaii.tech';

  IF n = 1 THEN
    UPDATE public.profiles p SET role = 'admin'
    FROM auth.users u
    WHERE u.id = p.auth_id AND lower(u.email) = 'noahccooper@colaii.tech';
    RAISE NOTICE 'Noah: granted admin (1 match).';
  ELSE
    RAISE NOTICE 'Noah: % matches for noahccooper@colaii.tech — NOT granted. (Sign in with Apple may use a relay email; find the profile and run: UPDATE public.profiles SET role = ''admin'' WHERE id = ''<profile id>'';)', n;
  END IF;
END $$;

-- Check the result:
SELECT p.id, p.username, p.display_name, p.role, u.email
FROM public.profiles p LEFT JOIN auth.users u ON u.id = p.auth_id
WHERE p.role = 'admin';
