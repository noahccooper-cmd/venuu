-- =============================================
-- venuu Push Notification Tokens — Database Schema
-- Run this in Supabase SQL Editor
-- =============================================

CREATE TABLE IF NOT EXISTS push_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token text NOT NULL,
  platform varchar(10) DEFAULT 'ios',
  city varchar(50),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, token)
);

CREATE INDEX idx_push_tokens_user ON push_tokens (user_id);
CREATE INDEX idx_push_tokens_city ON push_tokens (city);

ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own tokens"
  ON push_tokens FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
