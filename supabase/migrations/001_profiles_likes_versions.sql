-- ============================================================
-- 001: Sketches, Profiles, Likes, Forks, Versioning
-- ============================================================

-- ── Sketches (base table) ──────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sketches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Untitled',
  script TEXT NOT NULL DEFAULT '',
  is_public BOOLEAN NOT NULL DEFAULT false,
  forked_from UUID REFERENCES public.sketches(id) ON DELETE SET NULL,
  like_count INTEGER NOT NULL DEFAULT 0,
  fork_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.sketches ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sketches' AND policyname = 'Users can read own sketches') THEN
    CREATE POLICY "Users can read own sketches"
      ON public.sketches FOR SELECT
      USING (auth.uid() = user_id OR is_public = true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sketches' AND policyname = 'Users can insert own sketches') THEN
    CREATE POLICY "Users can insert own sketches"
      ON public.sketches FOR INSERT
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sketches' AND policyname = 'Users can update own sketches') THEN
    CREATE POLICY "Users can update own sketches"
      ON public.sketches FOR UPDATE
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sketches' AND policyname = 'Users can delete own sketches') THEN
    CREATE POLICY "Users can delete own sketches"
      ON public.sketches FOR DELETE
      USING (auth.uid() = user_id);
  END IF;
END $$;

DO $$ BEGIN RAISE NOTICE '[001] ✓ sketches table ready'; END $$;

-- ── Profiles ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  bio TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auto-create a profile when a user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
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
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'profiles' AND policyname = 'Profiles are publicly readable') THEN
    CREATE POLICY "Profiles are publicly readable"
      ON public.profiles FOR SELECT
      USING (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'profiles' AND policyname = 'Users can update their own profile') THEN
    CREATE POLICY "Users can update their own profile"
      ON public.profiles FOR UPDATE
      USING (auth.uid() = id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'profiles' AND policyname = 'Users can insert their own profile') THEN
    CREATE POLICY "Users can insert their own profile"
      ON public.profiles FOR INSERT
      WITH CHECK (auth.uid() = id);
  END IF;
END $$;

DO $$ BEGIN RAISE NOTICE '[001] ✓ profiles table + auto-create trigger ready'; END $$;

-- ── Likes ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sketch_likes (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sketch_id UUID NOT NULL REFERENCES public.sketches(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, sketch_id)
);

ALTER TABLE public.sketch_likes ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sketch_likes' AND policyname = 'Likes are publicly readable') THEN
    CREATE POLICY "Likes are publicly readable"
      ON public.sketch_likes FOR SELECT
      USING (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sketch_likes' AND policyname = 'Users can insert their own likes') THEN
    CREATE POLICY "Users can insert their own likes"
      ON public.sketch_likes FOR INSERT
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sketch_likes' AND policyname = 'Users can delete their own likes') THEN
    CREATE POLICY "Users can delete their own likes"
      ON public.sketch_likes FOR DELETE
      USING (auth.uid() = user_id);
  END IF;
END $$;

-- Atomic counter functions
CREATE OR REPLACE FUNCTION public.increment_like_count(sketch_id UUID)
RETURNS VOID AS $$
  UPDATE public.sketches s SET like_count = s.like_count + 1 WHERE s.id = sketch_id;
$$ LANGUAGE sql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.decrement_like_count(sketch_id UUID)
RETURNS VOID AS $$
  UPDATE public.sketches s SET like_count = GREATEST(s.like_count - 1, 0) WHERE s.id = sketch_id;
$$ LANGUAGE sql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.increment_fork_count(sketch_id UUID)
RETURNS VOID AS $$
  UPDATE public.sketches s SET fork_count = s.fork_count + 1 WHERE s.id = sketch_id;
$$ LANGUAGE sql SECURITY DEFINER;

DO $$ BEGIN RAISE NOTICE '[001] ✓ sketch_likes table + counter functions ready'; END $$;

-- ── Sketch Versions ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sketch_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sketch_id UUID NOT NULL REFERENCES public.sketches(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  script TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.sketch_versions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sketch_versions' AND policyname = 'Versions readable by sketch owner') THEN
    CREATE POLICY "Versions readable by sketch owner"
      ON public.sketch_versions FOR SELECT
      USING (
        EXISTS (SELECT 1 FROM public.sketches WHERE sketches.id = sketch_versions.sketch_id AND sketches.user_id = auth.uid())
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sketch_versions' AND policyname = 'Versions insertable by sketch owner') THEN
    CREATE POLICY "Versions insertable by sketch owner"
      ON public.sketch_versions FOR INSERT
      WITH CHECK (
        EXISTS (SELECT 1 FROM public.sketches WHERE sketches.id = sketch_versions.sketch_id AND sketches.user_id = auth.uid())
      );
  END IF;
END $$;

DO $$ BEGIN RAISE NOTICE '[001] ✓ sketch_versions table ready'; END $$;

-- ── Indexes ────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_sketch_versions_sketch_id
  ON public.sketch_versions(sketch_id, version_number DESC);

CREATE INDEX IF NOT EXISTS idx_sketches_public
  ON public.sketches(is_public, updated_at DESC) WHERE is_public = true;

CREATE INDEX IF NOT EXISTS idx_sketches_user
  ON public.sketches(user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_profiles_username
  ON public.profiles(username);

DO $$ BEGIN RAISE NOTICE '[001] ✓ indexes created — migration complete'; END $$;
