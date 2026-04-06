-- ============================================================
-- 003: Credits — prepaid balance for AI and audio generation
-- ============================================================

CREATE TABLE IF NOT EXISTS public.credits (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  balance_cents INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.credits ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'credits' AND policyname = 'Users can read own credits') THEN
    CREATE POLICY "Users can read own credits"
      ON public.credits FOR SELECT
      USING (auth.uid() = user_id);
  END IF;
END $$;

-- No user-facing insert/update policies — only the service role (webhook/proxy) can modify credits

DO $$ BEGIN RAISE NOTICE '[003] ✓ credits table ready'; END $$;
