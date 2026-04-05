-- Community Sample Library — shared audio samples with tags and vector embeddings

-- Enable pgvector for semantic search
create extension if not exists vector with schema extensions;

-- Create the storage bucket for community samples (public read, authenticated write)
insert into storage.buckets (id, name, public)
values ('community-samples', 'community-samples', true)
on conflict (id) do nothing;

-- Storage policies: anyone can read, authenticated users can upload to their folder
create policy "Public read community samples"
  on storage.objects for select
  using (bucket_id = 'community-samples');

create policy "Auth users upload community samples"
  on storage.objects for insert
  with check (bucket_id = 'community-samples' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Owners delete community samples"
  on storage.objects for delete
  using (bucket_id = 'community-samples' and auth.uid()::text = (storage.foldername(name))[1]);

create table if not exists public.community_samples (
  id uuid primary key default gen_random_uuid(),
  uploader_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text not null default '',
  tags text[] not null default '{}',
  storage_path text not null unique,
  content_hash text,                           -- SHA-256 of first 64KB for dedup
  size_bytes integer not null,
  duration_ms integer not null,
  waveform_peaks jsonb,                        -- ~100 peak values for mini waveform
  embedding extensions.vector(1536),           -- text-embedding-3-small
  download_count integer not null default 0,
  created_at timestamptz not null default now()
);

-- Indexes for efficient queries
create index idx_community_tags on public.community_samples using gin (tags);
create index idx_community_popular on public.community_samples (download_count desc, created_at desc);
create index idx_community_uploader on public.community_samples (uploader_id);
create index idx_community_name on public.community_samples using gin (to_tsvector('english', name || ' ' || description));

-- Vector similarity index (ivfflat requires some rows to exist first,
-- so we create it as ivfflat with a low list count; can be retuned later)
-- Note: create this index after initial data load for best performance
-- create index idx_community_embedding on public.community_samples
--   using ivfflat (embedding extensions.vector_cosine_ops) with (lists = 50);

-- RLS
alter table public.community_samples enable row level security;

create policy "Anyone can read community samples"
  on public.community_samples for select using (true);

create policy "Authenticated users can upload"
  on public.community_samples for insert
  with check (auth.uid() = uploader_id);

create policy "Owners can update their samples"
  on public.community_samples for update
  using (auth.uid() = uploader_id);

create policy "Owners can delete their samples"
  on public.community_samples for delete
  using (auth.uid() = uploader_id);

-- Atomic download counter (SECURITY DEFINER so any authenticated user can increment)
create or replace function public.increment_community_download(sample_id uuid)
returns void as $$
  update public.community_samples
  set download_count = download_count + 1
  where id = sample_id;
$$ language sql security definer;

-- Full-text search function
create or replace function public.search_community_samples(
  query text,
  max_results integer default 20
)
returns setof public.community_samples as $$
  select *
  from public.community_samples
  where to_tsvector('english', name || ' ' || description) @@ plainto_tsquery('english', query)
  order by ts_rank(to_tsvector('english', name || ' ' || description), plainto_tsquery('english', query)) desc
  limit max_results;
$$ language sql stable security definer;

-- Vector similarity search function
create or replace function public.search_community_by_embedding(
  query_embedding extensions.vector(1536),
  match_threshold float default 0.5,
  max_results integer default 20
)
returns table (
  id uuid,
  name text,
  description text,
  tags text[],
  storage_path text,
  size_bytes integer,
  duration_ms integer,
  waveform_peaks jsonb,
  download_count integer,
  uploader_id uuid,
  created_at timestamptz,
  similarity float
) as $$
  select
    cs.id, cs.name, cs.description, cs.tags, cs.storage_path,
    cs.size_bytes, cs.duration_ms, cs.waveform_peaks,
    cs.download_count, cs.uploader_id, cs.created_at,
    1 - (cs.embedding <=> query_embedding) as similarity
  from public.community_samples cs
  where cs.embedding is not null
    and 1 - (cs.embedding <=> query_embedding) > match_threshold
  order by cs.embedding <=> query_embedding
  limit max_results;
$$ language sql stable security definer;
