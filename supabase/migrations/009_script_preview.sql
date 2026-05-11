-- ============================================================
-- 009: script_preview generated column on sketches
--      Avoids transferring multi-KB script bodies for list views.
--      Apply with: supabase db query --linked < supabase/migrations/009_script_preview.sql
-- ============================================================

ALTER TABLE public.sketches
  ADD COLUMN IF NOT EXISTS script_preview TEXT
  GENERATED ALWAYS AS (substring(script FOR 200)) STORED;

DO $$ BEGIN RAISE NOTICE '[009] ✓ sketches.script_preview ready'; END $$;
