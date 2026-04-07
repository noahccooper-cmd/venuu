-- Fix events RLS for Bouncer Portal (PIN-based auth, no Supabase Auth session)
-- The bouncer portal uses the anon key, so UPDATE/DELETE must allow anon role.

-- Drop restrictive UPDATE policies
DROP POLICY IF EXISTS "Creator can update own events" ON events;
DROP POLICY IF EXISTS "Service role can update events" ON events;

-- Allow anyone to update events (portal uses anon key)
CREATE POLICY "Anyone can update events"
  ON events FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- Drop restrictive DELETE policy and allow anon
DROP POLICY IF EXISTS "Service role can delete events" ON events;

CREATE POLICY "Anyone can delete events"
  ON events FOR DELETE
  USING (true);
