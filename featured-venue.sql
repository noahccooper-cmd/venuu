-- Featured Venue Infrastructure
-- Adds featured column and label to venues table, activates LunaVerse as first featured venue

ALTER TABLE venues ADD COLUMN IF NOT EXISTS featured boolean DEFAULT false;
ALTER TABLE venues ADD COLUMN IF NOT EXISTS featured_label text;

UPDATE venues SET featured = true, featured_label = 'Featured Club' WHERE slug = 'lunaverse';
