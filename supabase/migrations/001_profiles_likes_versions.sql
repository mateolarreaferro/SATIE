-- ============================================================
-- Satie: Profiles, Likes, Forks, Versioning
-- Run this in your Supabase SQL Editor
-- ============================================================

-- ── Profiles ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  bio TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-create a profile when a user signs up
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, username, display_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'user_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'),
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- RLS for profiles
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Profiles are publicly readable"
  ON profiles FOR SELECT
  USING (true);

CREATE POLICY "Users can update their own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "Users can insert their own profile"
  ON profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- ── Sketch columns for forks and likes ──────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sketches' AND column_name='forked_from') THEN
    ALTER TABLE sketches ADD COLUMN forked_from UUID REFERENCES sketches(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sketches' AND column_name='like_count') THEN
    ALTER TABLE sketches ADD COLUMN like_count INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sketches' AND column_name='fork_count') THEN
    ALTER TABLE sketches ADD COLUMN fork_count INTEGER DEFAULT 0;
  END IF;
END $$;

-- ── Likes ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sketch_likes (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sketch_id UUID NOT NULL REFERENCES sketches(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, sketch_id)
);

ALTER TABLE sketch_likes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Likes are publicly readable"
  ON sketch_likes FOR SELECT
  USING (true);

CREATE POLICY "Users can insert their own likes"
  ON sketch_likes FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own likes"
  ON sketch_likes FOR DELETE
  USING (auth.uid() = user_id);

-- RPC functions for atomic counter updates
CREATE OR REPLACE FUNCTION increment_like_count(sketch_id UUID)
RETURNS VOID AS $$
  UPDATE sketches SET like_count = like_count + 1 WHERE id = sketch_id;
$$ LANGUAGE sql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION decrement_like_count(sketch_id UUID)
RETURNS VOID AS $$
  UPDATE sketches SET like_count = GREATEST(like_count - 1, 0) WHERE id = sketch_id;
$$ LANGUAGE sql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION increment_fork_count(sketch_id UUID)
RETURNS VOID AS $$
  UPDATE sketches SET fork_count = fork_count + 1 WHERE id = sketch_id;
$$ LANGUAGE sql SECURITY DEFINER;

-- ── Sketch Versions ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sketch_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sketch_id UUID NOT NULL REFERENCES sketches(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  script TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sketch_versions_sketch_id
  ON sketch_versions(sketch_id, version_number DESC);

ALTER TABLE sketch_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Versions readable by sketch owner"
  ON sketch_versions FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM sketches WHERE sketches.id = sketch_versions.sketch_id AND sketches.user_id = auth.uid())
  );

CREATE POLICY "Versions insertable by sketch owner"
  ON sketch_versions FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM sketches WHERE sketches.id = sketch_versions.sketch_id AND sketches.user_id = auth.uid())
  );

-- ── Indexes for gallery queries ─────────────────────────────

CREATE INDEX IF NOT EXISTS idx_sketches_public ON sketches(is_public, updated_at DESC) WHERE is_public = true;
CREATE INDEX IF NOT EXISTS idx_sketches_user ON sketches(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_profiles_username ON profiles(username);
