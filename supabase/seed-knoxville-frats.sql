-- =============================================
-- venuu — UTK Fraternity Venues (Knoxville, TN)
-- Run in Supabase SQL Editor
--
-- UPDATE coordinates before running:
-- All lat/lng are placeholders near UTK fraternity row.
-- Replace with exact Google Maps pin for each house.
-- =============================================

INSERT INTO venues (name, slug, city, category, address, lat, lng, is_active, sort_order) VALUES
  ('Sigma Chi', 'sigma-chi-utk', 'Knoxville, TN', 'fraternity', '1604 Fraternity Park Dr, Knoxville, TN 37916', 35.9558, -83.9312, true, 500),
  ('Pi Kappa Alpha', 'pike-utk', 'Knoxville, TN', 'fraternity', '1820 Fraternity Park Dr, Knoxville, TN 37916', 35.9555, -83.9320, true, 501),
  ('Sigma Alpha Epsilon', 'sae-utk', 'Knoxville, TN', 'fraternity', '1807 Fraternity Park Dr, Knoxville, TN 37916', 35.9552, -83.9328, true, 502),
  ('Kappa Sigma', 'kappa-sigma-utk', 'Knoxville, TN', 'fraternity', '1800 Fraternity Park Dr, Knoxville, TN 37916', 35.9549, -83.9336, true, 503),
  ('Beta Theta Pi', 'beta-utk', 'Knoxville, TN', 'fraternity', '1804 Fraternity Park Dr, Knoxville, TN 37916', 35.9546, -83.9305, true, 504),
  ('Lambda Chi Alpha', 'lambda-chi-utk', 'Knoxville, TN', 'fraternity', '1616 Fraternity Park Dr, Knoxville, TN 37916', 35.9543, -83.9318, true, 505),
  ('Phi Delta Theta', 'phi-delt-utk', 'Knoxville, TN', 'fraternity', '1817 Fraternity Park Dr, Knoxville, TN 37916', 35.9540, -83.9325, true, 506),
  ('Sigma Nu', 'sigma-nu-utk', 'Knoxville, TN', 'fraternity', '1815 Fraternity Park Dr, Knoxville, TN 37916', 35.9561, -83.9310, true, 507),
  ('Alpha Tau Omega', 'ato-utk', 'Knoxville, TN', 'fraternity', '1608 Fraternity Park Dr, Knoxville, TN 37916', 35.9564, -83.9315, true, 508),
  ('Kappa Alpha Order', 'ka-utk', 'Knoxville, TN', 'fraternity', '1811 Fraternity Park Dr, Knoxville, TN 37916', 35.9537, -83.9333, true, 509),
  ('Delta Tau Delta', 'delts-utk', 'Knoxville, TN', 'fraternity', '1822 Fraternity Park Dr, Knoxville, TN 37916', 35.9534, -83.9340, true, 510),
  ('Sigma Phi Epsilon', 'sigep-utk', 'Knoxville, TN', 'fraternity', '1612 Fraternity Park Dr, Knoxville, TN 37916', 35.9567, -83.9308, true, 511),
  ('Phi Gamma Delta', 'fiji-utk', 'Knoxville, TN', 'fraternity', '1809 Fraternity Park Dr, Knoxville, TN 37916', 35.9531, -83.9322, true, 512),
  ('Pi Kappa Phi', 'pi-kapp-utk', 'Knoxville, TN', 'fraternity', '1620 Fraternity Park Dr, Knoxville, TN 37916', 35.9570, -83.9302, true, 513),
  ('Theta Chi', 'theta-chi-utk', 'Knoxville, TN', 'fraternity', '1813 Fraternity Park Dr, Knoxville, TN 37916', 35.9528, -83.9330, true, 514)
ON CONFLICT (slug) DO NOTHING;
