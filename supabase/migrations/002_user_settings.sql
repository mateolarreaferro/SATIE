-- ============================================================
-- 002: User settings (API keys, preferences)
-- Keys are encrypted at rest by Supabase default storage encryption.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.user_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  anthropic_key TEXT NOT NULL DEFAULT '',
  elevenlabs_key TEXT NOT NULL DEFAULT '',
  openai_key TEXT NOT NULL DEFAULT '',
  gemini_key TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'user_settings' AND policyname = 'Users can read own settings') THEN
    CREATE POLICY "Users can read own settings"
      ON public.user_settings FOR SELECT
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'user_settings' AND policyname = 'Users can insert own settings') THEN
    CREATE POLICY "Users can insert own settings"
      ON public.user_settings FOR INSERT
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'user_settings' AND policyname = 'Users can update own settings') THEN
    CREATE POLICY "Users can update own settings"
      ON public.user_settings FOR UPDATE
      USING (auth.uid() = user_id);
  END IF;
END $$;

DO $$ BEGIN RAISE NOTICE '[002] ✓ user_settings table ready'; END $$;
