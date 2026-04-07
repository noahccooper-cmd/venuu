-- =============================================
-- venuu — Oxford, MS Bar Venues (Ole Miss)
-- Run in Supabase SQL Editor
--
-- INSTRUCTIONS:
-- 1. Fill in each bar from your Oxford team's Google Sheet
-- 2. Get exact lat/lng from Google Maps (right-click → coordinates)
-- 3. City MUST be 'Oxford, MS' (matches venuu city format)
-- 4. Category: 'bar' for all bars
-- 5. slug: lowercase-hyphenated unique identifier
-- 6. sort_order: start at 100 for bars
-- =============================================

-- TEMPLATE — copy and fill for each bar:
-- INSERT INTO venues (name, slug, city, category, address, lat, lng, is_active, sort_order)
-- VALUES ('Bar Name', 'bar-name-oxford', 'Oxford, MS', 'bar', '123 The Square, Oxford, MS 38655', 34.XXXX, -89.XXXX, true, 100);

-- EXAMPLE (replace with real data):
-- INSERT INTO venues (name, slug, city, category, address, lat, lng, is_active, sort_order)
-- VALUES ('The Blind Pig', 'blind-pig-oxford', 'Oxford, MS', 'bar', '115 Courthouse Sq, Oxford, MS 38655', 34.3665, -89.5195, true, 100);

-- Paste your bar inserts below this line:
-- ─────────────────────────────────────────────
