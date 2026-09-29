-- ═══════════════════════════════════════════════════════════════════
-- 00080_brand_products.sql — product row for Partner Worlds (run after 00077).
--
-- brands.products: the About sheet's product row, e.g.
--   [{"name": "Classic Iced Tea", "image_url": "https://…/brand-assets/…"}]
-- image_url stays null until the file is uploaded to the brand-assets
-- bucket; the app shows the name alone until then. A new partner's
-- products are just data on its row — no app change.
--
-- Idempotent: the column is added only if missing, and the seed fills
-- products only while it is still empty (never overwrites admin edits).
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.brands
  ADD COLUMN IF NOT EXISTS products jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'brands_products_is_array'
                 AND conrelid = 'public.brands'::regclass) THEN
    ALTER TABLE public.brands ADD CONSTRAINT brands_products_is_array
      CHECK (jsonb_typeof(products) = 'array');
  END IF;
END $$;

UPDATE public.brands
SET products = '[
  {"name": "Classic Iced Tea", "image_url": null},
  {"name": "Classic Lemonade", "image_url": null},
  {"name": "Half & Half", "image_url": null}
]'::jsonb
WHERE slug = 'sun_cruiser' AND products = '[]'::jsonb;

COMMIT;
