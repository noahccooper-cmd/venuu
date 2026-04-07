-- =============================================
-- venuu NFC Loyalty System — Add columns to venues table
-- Run this in Supabase SQL Editor
-- =============================================

-- Master switch: when true, students can tap NFC to check in
ALTER TABLE venues ADD COLUMN IF NOT EXISTS loyalty_active boolean DEFAULT false;

-- Unique identifier written to the physical NFC card at the venue
ALTER TABLE venues ADD COLUMN IF NOT EXISTS nfc_tag_id text;

-- Index for NFC tag lookups
CREATE INDEX IF NOT EXISTS idx_venues_nfc_tag ON venues (nfc_tag_id) WHERE nfc_tag_id IS NOT NULL;
