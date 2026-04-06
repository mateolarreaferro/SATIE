-- ============================================================
-- 005: Community Sample Library — shared audio samples
--      with tags and vector embeddings for semantic search
-- ============================================================

-- Enable pgvector for semantic search
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- ── Storage bucket ─────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public)
VALUES ('community-samples', 'community-samples', true)
ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'Public read community samples') THEN
    CREATE POLICY "Public read community samples"
      ON storage.objects FOR SELECT
      USING (bucket_id = 'community-samples');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'Auth users upload community samples') THEN
    CREATE POLICY "Auth users upload community samples"
      ON storage.objects FOR INSERT
      WITH CHECK (bucket_id = 'community-samples' AND auth.uid()::text = (storage.foldername(name))[1]);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'Owners delete community samples') THEN
    CREATE POLICY "Owners delete community samples"
      ON storage.objects FOR DELETE
      USING (bucket_id = 'community-samples' AND auth.uid()::text = (storage.foldername(name))[1]);
  END IF;
END $$;

DO $$ BEGIN RAISE NOTICE '[005] ✓ community-samples storage bucket ready'; END $$;

-- ── Community samples table ────────────────────────────────

CREATE TABLE IF NOT EXISTS public.community_samples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uploader_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  tags TEXT[] NOT NULL DEFAULT '{}',
  storage_path TEXT NOT NULL UNIQUE,
  content_hash TEXT,
  size_bytes INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  waveform_peaks JSONB,
  embedding extensions.vector(1536),
  download_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_community_tags
  ON public.community_samples USING gin (tags);

CREATE INDEX IF NOT EXISTS idx_community_popular
  ON public.community_samples (download_count DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_community_uploader
  ON public.community_samples (uploader_id);

CREATE INDEX IF NOT EXISTS idx_community_name
  ON public.community_samples USING gin (to_tsvector('english', name || ' ' || description));

DO $$ BEGIN RAISE NOTICE '[005] ✓ community_samples table + indexes ready'; END $$;

-- ── RLS ────────────────────────────────────────────────────

ALTER TABLE public.community_samples ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'community_samples' AND policyname = 'Anyone can read community samples') THEN
    CREATE POLICY "Anyone can read community samples"
      ON public.community_samples FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'community_samples' AND policyname = 'Authenticated users can upload') THEN
    CREATE POLICY "Authenticated users can upload"
      ON public.community_samples FOR INSERT
      WITH CHECK (auth.uid() = uploader_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'community_samples' AND policyname = 'Owners can update their samples') THEN
    CREATE POLICY "Owners can update their samples"
      ON public.community_samples FOR UPDATE
      USING (auth.uid() = uploader_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'community_samples' AND policyname = 'Owners can delete their samples') THEN
    CREATE POLICY "Owners can delete their samples"
      ON public.community_samples FOR DELETE
      USING (auth.uid() = uploader_id);
  END IF;
END $$;

-- ── Functions ──────────────────────────────────────────────

-- Atomic download counter
CREATE OR REPLACE FUNCTION public.increment_community_download(sample_id UUID)
RETURNS VOID AS $$
  UPDATE public.community_samples
  SET download_count = download_count + 1
  WHERE id = sample_id;
$$ LANGUAGE sql SECURITY DEFINER;

-- Full-text search
CREATE OR REPLACE FUNCTION public.search_community_samples(
  query TEXT,
  max_results INTEGER DEFAULT 20
)
RETURNS SETOF public.community_samples AS $$
  SELECT *
  FROM public.community_samples
  WHERE to_tsvector('english', name || ' ' || description) @@ plainto_tsquery('english', query)
  ORDER BY ts_rank(to_tsvector('english', name || ' ' || description), plainto_tsquery('english', query)) DESC
  LIMIT max_results;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Vector similarity search
CREATE OR REPLACE FUNCTION public.search_community_by_embedding(
  query_embedding extensions.vector(1536),
  match_threshold FLOAT DEFAULT 0.5,
  max_results INTEGER DEFAULT 20
)
RETURNS TABLE (
  id UUID,
  name TEXT,
  description TEXT,
  tags TEXT[],
  storage_path TEXT,
  size_bytes INTEGER,
  duration_ms INTEGER,
  waveform_peaks JSONB,
  download_count INTEGER,
  uploader_id UUID,
  created_at TIMESTAMPTZ,
  similarity FLOAT
) AS $$
  SELECT
    cs.id, cs.name, cs.description, cs.tags, cs.storage_path,
    cs.size_bytes, cs.duration_ms, cs.waveform_peaks,
    cs.download_count, cs.uploader_id, cs.created_at,
    1 - (cs.embedding <=> query_embedding) AS similarity
  FROM public.community_samples cs
  WHERE cs.embedding IS NOT NULL
    AND 1 - (cs.embedding <=> query_embedding) > match_threshold
  ORDER BY cs.embedding <=> query_embedding
  LIMIT max_results;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

DO $$ BEGIN RAISE NOTICE '[005] ✓ community samples migration complete'; END $$;
