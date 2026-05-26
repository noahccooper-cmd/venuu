-- Add user_moment_number column to venue_recaps.
-- This is the user's personal count: their nth venue ever captured.
-- Engraved into the photo permanently. The mythological identity.

ALTER TABLE public.venue_recaps
  ADD COLUMN IF NOT EXISTS user_moment_number int;

-- Backfill existing rows. For each existing recap, compute
-- the user's count of recaps up to and including that one
-- (chronological order by created_at). This is a one-shot
-- backfill — production rows will be set on insert by the RPC.
WITH numbered AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id
      ORDER BY created_at ASC
    ) AS rn
  FROM public.venue_recaps
  WHERE user_id IS NOT NULL
)
UPDATE public.venue_recaps r
SET user_moment_number = n.rn
FROM numbered n
WHERE r.id = n.id
  AND r.user_moment_number IS NULL;

COMMENT ON COLUMN public.venue_recaps.user_moment_number IS
  'The user''s personal count of moments captured. Their 1st = #1, 2nd = #2, etc. Engraved into the JPEG permanently.';
