-- ============================================================
-- 004: Add free_credits_claimed flag to credits
-- ============================================================

ALTER TABLE public.credits ADD COLUMN IF NOT EXISTS free_credits_claimed BOOLEAN NOT NULL DEFAULT false;

DO $$ BEGIN RAISE NOTICE '[004] ✓ free_credits_claimed column ready'; END $$;
