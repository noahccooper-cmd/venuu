-- =============================================
-- venuu Security Organizations — Multi-venue Portal
-- Run in Supabase SQL Editor
-- =============================================

CREATE TABLE IF NOT EXISTS security_organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  org_code text UNIQUE NOT NULL,
  city text,
  contact_name text,
  contact_phone text,
  contact_email text,
  created_at timestamptz DEFAULT now(),
  is_active boolean DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_security_orgs_code ON security_organizations (org_code);

CREATE TABLE IF NOT EXISTS organization_venues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES security_organizations(id) ON DELETE CASCADE,
  venue_id uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  UNIQUE(org_id, venue_id)
);

CREATE INDEX IF NOT EXISTS idx_org_venues_org ON organization_venues (org_id);
CREATE INDEX IF NOT EXISTS idx_org_venues_venue ON organization_venues (venue_id);

ALTER TABLE security_organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_venues ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read orgs" ON security_organizations FOR SELECT USING (true);
CREATE POLICY "Anyone can insert orgs" ON security_organizations FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update orgs" ON security_organizations FOR UPDATE USING (true) WITH CHECK (true);

CREATE POLICY "Anyone can read org venues" ON organization_venues FOR SELECT USING (true);
CREATE POLICY "Anyone can insert org venues" ON organization_venues FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update org venues" ON organization_venues FOR UPDATE USING (true) WITH CHECK (true);
