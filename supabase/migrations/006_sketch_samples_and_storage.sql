-- ============================================================
-- 006: Sketch samples table + storage buckets (samples, thumbnails)
-- ============================================================

-- ── Storage buckets ────────────────────────────────────────

-- Samples bucket: stores audio files per sketch ({user_id}/{sketch_id}/{filename})
INSERT INTO storage.buckets (id, name, public)
VALUES ('samples', 'samples', true)
ON CONFLICT (id) DO NOTHING;

-- Thumbnails bucket: stores sketch preview images ({user_id}/{sketch_id}/thumbnail.jpg)
INSERT INTO storage.buckets (id, name, public)
VALUES ('thumbnails', 'thumbnails', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for samples bucket
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'Public read samples') THEN
    CREATE POLICY "Public read samples"
      ON storage.objects FOR SELECT
      USING (bucket_id = 'samples');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'Auth users upload samples') THEN
    CREATE POLICY "Auth users upload samples"
      ON storage.objects FOR INSERT
      WITH CHECK (bucket_id = 'samples' AND auth.uid()::text = (storage.foldername(name))[1]);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'Owners delete samples') THEN
    CREATE POLICY "Owners delete samples"
      ON storage.objects FOR DELETE
      USING (bucket_id = 'samples' AND auth.uid()::text = (storage.foldername(name))[1]);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'Owners update samples') THEN
    CREATE POLICY "Owners update samples"
      ON storage.objects FOR UPDATE
      USING (bucket_id = 'samples' AND auth.uid()::text = (storage.foldername(name))[1]);
  END IF;
END $$;

-- Storage policies for thumbnails bucket
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'Public read thumbnails') THEN
    CREATE POLICY "Public read thumbnails"
      ON storage.objects FOR SELECT
      USING (bucket_id = 'thumbnails');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'Auth users upload thumbnails') THEN
    CREATE POLICY "Auth users upload thumbnails"
      ON storage.objects FOR INSERT
      WITH CHECK (bucket_id = 'thumbnails' AND auth.uid()::text = (storage.foldername(name))[1]);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'Owners update thumbnails') THEN
    CREATE POLICY "Owners update thumbnails"
      ON storage.objects FOR UPDATE
      USING (bucket_id = 'thumbnails' AND auth.uid()::text = (storage.foldername(name))[1]);
  END IF;
END $$;

DO $$ BEGIN RAISE NOTICE '[006] ✓ samples + thumbnails storage buckets ready'; END $$;

-- ── Sketch samples manifest table ─────────────────────────

CREATE TABLE IF NOT EXISTS public.sketch_samples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sketch_id UUID NOT NULL REFERENCES public.sketches(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (sketch_id, filename)
);

CREATE INDEX IF NOT EXISTS idx_sketch_samples_sketch
  ON public.sketch_samples (sketch_id);

ALTER TABLE public.sketch_samples ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sketch_samples' AND policyname = 'Sketch samples are publicly readable') THEN
    CREATE POLICY "Sketch samples are publicly readable"
      ON public.sketch_samples FOR SELECT
      USING (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sketch_samples' AND policyname = 'Users can insert own sketch samples') THEN
    CREATE POLICY "Users can insert own sketch samples"
      ON public.sketch_samples FOR INSERT
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sketch_samples' AND policyname = 'Users can update own sketch samples') THEN
    CREATE POLICY "Users can update own sketch samples"
      ON public.sketch_samples FOR UPDATE
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sketch_samples' AND policyname = 'Users can delete own sketch samples') THEN
    CREATE POLICY "Users can delete own sketch samples"
      ON public.sketch_samples FOR DELETE
      USING (auth.uid() = user_id);
  END IF;
END $$;

DO $$ BEGIN RAISE NOTICE '[006] ✓ sketch_samples table ready — migration complete'; END $$;
