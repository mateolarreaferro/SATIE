-- Migration 008: Add missing indexes on foreign keys
-- Addresses unindexed_foreign_keys lint for 3 tables.
-- idx_profiles_username is kept (used by /u/:username route, just low traffic).

CREATE INDEX IF NOT EXISTS idx_sketch_likes_sketch_id
  ON public.sketch_likes (sketch_id);

CREATE INDEX IF NOT EXISTS idx_sketch_samples_user_id
  ON public.sketch_samples (user_id);

CREATE INDEX IF NOT EXISTS idx_sketches_forked_from
  ON public.sketches (forked_from);
