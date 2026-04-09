-- Migration 007: Fix Supabase performance lints
-- 1. RLS InitPlan: wrap auth.uid() in (select ...) for per-query evaluation
-- 2. Multiple permissive policies: consolidate redundant SELECT/INSERT policies
-- 3. Duplicate index: drop redundant sketch_samples index

BEGIN;

-- ============================================================
-- ISSUE 1: RLS InitPlan — replace auth.uid() with (select auth.uid())
-- This makes Postgres evaluate auth.uid() once per query, not per row.
-- ============================================================

-- === sketches ===

DROP POLICY IF EXISTS "Users can read own sketches" ON public.sketches;
CREATE POLICY "Users can read own sketches" ON public.sketches
  FOR SELECT USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can insert own sketches" ON public.sketches;
CREATE POLICY "Users can insert own sketches" ON public.sketches
  FOR INSERT WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update own sketches" ON public.sketches;
CREATE POLICY "Users can update own sketches" ON public.sketches
  FOR UPDATE USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can delete own sketches" ON public.sketches;
CREATE POLICY "Users can delete own sketches" ON public.sketches
  FOR DELETE USING ((select auth.uid()) = user_id);

-- === sketch_samples ===

DROP POLICY IF EXISTS "Users can insert own sketch samples" ON public.sketch_samples;
CREATE POLICY "Users can insert own sketch samples" ON public.sketch_samples
  FOR INSERT WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update own sketch samples" ON public.sketch_samples;
CREATE POLICY "Users can update own sketch samples" ON public.sketch_samples
  FOR UPDATE USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can delete own sketch samples" ON public.sketch_samples;
CREATE POLICY "Users can delete own sketch samples" ON public.sketch_samples
  FOR DELETE USING ((select auth.uid()) = user_id);

-- === user_settings ===

DROP POLICY IF EXISTS "Users can read own settings" ON public.user_settings;
CREATE POLICY "Users can read own settings" ON public.user_settings
  FOR SELECT USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update own settings" ON public.user_settings;
CREATE POLICY "Users can update own settings" ON public.user_settings
  FOR UPDATE USING ((select auth.uid()) = user_id);

-- === sketch_likes ===

DROP POLICY IF EXISTS "Users can insert their own likes" ON public.sketch_likes;
CREATE POLICY "Users can insert their own likes" ON public.sketch_likes
  FOR INSERT WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can delete their own likes" ON public.sketch_likes;
CREATE POLICY "Users can delete their own likes" ON public.sketch_likes
  FOR DELETE USING ((select auth.uid()) = user_id);

-- === profiles ===

DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile" ON public.profiles
  FOR UPDATE USING ((select auth.uid()) = id);

DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
CREATE POLICY "Users can insert their own profile" ON public.profiles
  FOR INSERT WITH CHECK ((select auth.uid()) = id);

-- === sketch_versions ===

DROP POLICY IF EXISTS "Versions readable by sketch owner" ON public.sketch_versions;
CREATE POLICY "Versions readable by sketch owner" ON public.sketch_versions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM sketches
      WHERE sketches.id = sketch_versions.sketch_id
        AND sketches.user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Versions insertable by sketch owner" ON public.sketch_versions;
CREATE POLICY "Versions insertable by sketch owner" ON public.sketch_versions
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM sketches
      WHERE sketches.id = sketch_versions.sketch_id
        AND sketches.user_id = (select auth.uid())
    )
  );

-- === credits ===

DROP POLICY IF EXISTS "Users can read own credits" ON public.credits;
CREATE POLICY "Users can read own credits" ON public.credits
  FOR SELECT USING ((select auth.uid()) = user_id);

-- === community_samples ===

DROP POLICY IF EXISTS "Authenticated users can upload" ON public.community_samples;
CREATE POLICY "Authenticated users can upload" ON public.community_samples
  FOR INSERT WITH CHECK ((select auth.uid()) = uploader_id);

DROP POLICY IF EXISTS "Owners can update their samples" ON public.community_samples;
CREATE POLICY "Owners can update their samples" ON public.community_samples
  FOR UPDATE USING ((select auth.uid()) = uploader_id);

DROP POLICY IF EXISTS "Owners can delete their samples" ON public.community_samples;
CREATE POLICY "Owners can delete their samples" ON public.community_samples
  FOR DELETE USING ((select auth.uid()) = uploader_id);


-- ============================================================
-- ISSUE 2: Multiple permissive policies — consolidate redundant ones
-- ============================================================

-- --- sketch_samples SELECT ---
-- Currently 3 permissive SELECT policies:
--   "Sketch samples are publicly readable" (true)           ← keeps everything readable
--   "Anyone can read samples of public sketches" (EXISTS)   ← redundant (subset of true)
--   "Users can read own sketch samples" (auth.uid()=user_id) ← redundant (subset of true)
-- Keep only "Sketch samples are publicly readable" since it already grants full access.

DROP POLICY IF EXISTS "Anyone can read samples of public sketches" ON public.sketch_samples;
DROP POLICY IF EXISTS "Users can read own sketch samples" ON public.sketch_samples;

-- --- sketches SELECT ---
-- Currently 2 permissive SELECT policies:
--   "Anyone can read public sketches" (is_public = true)
--   "Users can read own sketches" (auth.uid() = user_id)
-- Merge into one policy with OR condition.

DROP POLICY IF EXISTS "Anyone can read public sketches" ON public.sketches;
DROP POLICY IF EXISTS "Users can read own sketches" ON public.sketches;
CREATE POLICY "Users can read own or public sketches" ON public.sketches
  FOR SELECT USING (is_public = true OR (select auth.uid()) = user_id);

-- --- user_settings INSERT ---
-- Currently 2 identical permissive INSERT policies:
--   "Users can insert own settings" (auth.uid() = user_id)
--   "Users can upsert own settings" (auth.uid() = user_id)
-- Drop the duplicate, keep "Users can upsert own settings" (more descriptive for ON CONFLICT).

DROP POLICY IF EXISTS "Users can insert own settings" ON public.user_settings;
-- Recreate the upsert one with (select auth.uid()) optimization
DROP POLICY IF EXISTS "Users can upsert own settings" ON public.user_settings;
CREATE POLICY "Users can upsert own settings" ON public.user_settings
  FOR INSERT WITH CHECK ((select auth.uid()) = user_id);


-- ============================================================
-- ISSUE 3: Duplicate index on sketch_samples(sketch_id)
-- ============================================================

-- sketch_samples_sketch_id_idx and idx_sketch_samples_sketch are identical.
-- Keep idx_sketch_samples_sketch (from migration 006), drop the other.
DROP INDEX IF EXISTS public.sketch_samples_sketch_id_idx;

COMMIT;
