---
title: Database schema & migrations
subsystem: data
sources:
  - supabase/migrations/**
synced_sha: 15582d29fecb
synced: 2026-05-31
related: [../lib/database.md, ../lib/community.md]
---

## Purpose

The Postgres/Supabase schema behind Satie: sketches, profiles, social signals (likes/forks), versioning, per-sketch and community sample manifests, credits, and user-stored API keys — defined entirely by SQL migrations `001`–`009`.

## Why it exists / responsibilities

These migrations are the source of truth for the backend data model. They:

- Create every `public.*` table and its row-level security (RLS) policies.
- Wire `auth.users` → `public.profiles` auto-creation via a signup trigger.
- Define `SECURITY DEFINER` SQL functions for atomic counters (likes, forks, downloads) and for full-text / vector sample search.
- Provision Supabase Storage buckets (`community-samples`, `samples`, `thumbnails`) with their object-level RLS.
- Add performance fixes: per-query `auth.uid()`, FK indexes, a `script_preview` generated column.

Migrations are **idempotent** — every table uses `CREATE TABLE IF NOT EXISTS`, every policy is guarded by a `pg_policies` existence check or `DROP POLICY IF EXISTS`, and buckets use `ON CONFLICT (id) DO NOTHING`. They can be replayed safely.

## Mental model

```
auth.users ──(trigger handle_new_user)──▶ profiles
     │
     ├──▶ sketches ──┬──▶ sketch_versions   (history)
     │               ├──▶ sketch_likes      (PK user_id+sketch_id)
     │               ├──▶ sketch_samples     (per-sketch audio manifest)
     │               └── forked_from ▶ sketches (self-ref)
     │
     ├──▶ user_settings   (API keys)
     ├──▶ credits         (prepaid balance)
     └──▶ community_samples (shared CC0 library + pgvector)

Storage buckets: community-samples | samples | thumbnails
  path convention: {user_id}/{sketch_id}/{filename}
```

Two layers enforce access: table RLS (`public.*`) and storage object RLS (`storage.objects`, keyed by `bucket_id` + first path segment = `auth.uid()`).

## Key types & functions

Tables (all in `public`):

- **sketches** — base entity. `id`, `user_id`→auth.users, `title`, `script`, `is_public`, self-ref `forked_from`, denormalized `like_count`/`fork_count`, `script_preview` (generated). `supabase/migrations/001_profiles_likes_versions.sql:7`
- **profiles** — `id`=auth.users.id, unique `username`, `display_name`, `avatar_url`, `bio`. `supabase/migrations/001_profiles_likes_versions.sql:52`
- **sketch_likes** — junction, composite PK `(user_id, sketch_id)`. `supabase/migrations/001_profiles_likes_versions.sql:108`
- **sketch_versions** — `sketch_id`, `title`, `script`, `version_number`. `supabase/migrations/001_profiles_likes_versions.sql:157`
- **user_settings** — PK `user_id`; `anthropic_key`, `elevenlabs_key`, `openai_key`, `gemini_key`. `supabase/migrations/002_user_settings.sql:6`
- **credits** — PK `user_id`; `balance_cents`, `free_credits_claimed`. `supabase/migrations/003_credits.sql:5`, flag added `supabase/migrations/004_free_credits.sql:5`
- **community_samples** — `uploader_id`, `name`, `description`, `tags TEXT[]`, unique `storage_path`, `content_hash`, `size_bytes`, `duration_ms`, `waveform_peaks JSONB`, `embedding extensions.vector(1536)`, `download_count`. `supabase/migrations/005_community_samples.sql:39`
- **sketch_samples** — per-sketch manifest; `sketch_id`, `user_id`, `filename`, `storage_path`, `size_bytes`, unique `(sketch_id, filename)`. `supabase/migrations/006_sketch_samples_and_storage.sql:69`

Functions (`SECURITY DEFINER`):

- `handle_new_user()` — AFTER INSERT trigger on `auth.users`; inserts a profile from OAuth metadata. `supabase/migrations/001_profiles_likes_versions.sql:62`
- `increment_like_count` / `decrement_like_count` (clamped ≥0) / `increment_fork_count`. `supabase/migrations/001_profiles_likes_versions.sql:138`
- `increment_community_download(sample_id)`. `supabase/migrations/005_community_samples.sql:102`
- `search_community_samples(query, max_results)` — full-text over `name || ' ' || description`, ranked by `ts_rank`. `supabase/migrations/005_community_samples.sql:110`
- `search_community_by_embedding(query_embedding, match_threshold, max_results)` — cosine similarity `1 - (embedding <=> query)` over pgvector. `supabase/migrations/005_community_samples.sql:123`

Generated column:

- `sketches.script_preview TEXT GENERATED ALWAYS AS (substring(script FOR 200)) STORED` — first 200 chars; lets list views skip multi-KB `script` bodies. `supabase/migrations/009_script_preview.sql:7`

Indexes:

- `idx_sketch_versions_sketch_id (sketch_id, version_number DESC)`, partial `idx_sketches_public (is_public, updated_at DESC) WHERE is_public`, `idx_sketches_user`, `idx_profiles_username`. `supabase/migrations/001_profiles_likes_versions.sql:190`
- community: GIN on `tags`, popularity composite, `uploader_id`, GIN tsvector on name+description. `supabase/migrations/005_community_samples.sql:56`
- FK indexes: `idx_sketch_likes_sketch_id`, `idx_sketch_samples_user_id`, `idx_sketches_forked_from`. `supabase/migrations/008_index_foreign_keys.sql:5`

## Data flow

- The browser talks to these tables/functions through the Supabase JS client — see [database client](../lib/database.md). Sketch CRUD (`sketches`), likes (`sketch_likes` + counter RPCs), forks (`forked_from` + `increment_fork_count`), and versions (`sketch_versions`) flow through that layer.
- The [community library](../lib/community.md) reads/writes `community_samples`, calls `search_community_samples` / `search_community_by_embedding` RPCs, increments `increment_community_download`, and uploads to the `community-samples` storage bucket.
- On signup, Supabase Auth fires the `on_auth_user_created` trigger → `handle_new_user()` populates `profiles`. No client call needed.
- Credit balances are mutated only by the service role (webhook/proxy); clients have read-only RLS and no insert/update policy on `credits`.

## Invariants & gotchas

- **Counters are denormalized.** `like_count`/`fork_count`/`download_count` live on the row and are only correct if mutated via the `SECURITY DEFINER` RPCs — never increment them in client SQL, and never write a like without calling `increment_like_count`. `decrement_like_count` clamps at 0.
- **RLS `auth.uid()` must be wrapped as `(select auth.uid())`.** Migration `007` rewrote every policy to do this so Postgres evaluates it once per query, not per row (`InitPlan` lint). Any new policy must follow the same pattern. `supabase/migrations/007_fix_rls_performance_lints.sql:16`
- **One SELECT policy per table.** `007` consolidated overlapping permissive policies (multiple-permissive-policies lint). `sketches` SELECT is now the single `"Users can read own or public sketches"` (`is_public OR (select auth.uid()) = user_id`). `sketch_samples` SELECT is the single public-readable policy. Don't re-add redundant per-row policies. `supabase/migrations/007_fix_rls_performance_lints.sql:140`
- **`credits` has no client write policy** — only a SELECT-own policy. Inserts/updates require the service role.
- **`profiles` and `sketch_samples` are world-readable** (`USING (true)`), as is `community_samples`. Treat anything in them as public.
- **Storage RLS keys on path layout.** Upload/delete on `samples`, `thumbnails`, and `community-samples` require `auth.uid()::text = (storage.foldername(name))[1]`, i.e. the first path segment must be the uploader's user id. Files must be stored as `{user_id}/...`. `supabase/migrations/006_sketch_samples_and_storage.sql:25`
- **pgvector lives in the `extensions` schema.** The column type is `extensions.vector(1536)` (1536-dim, OpenAI embedding size); reference it fully-qualified. Embedding may be NULL — `search_community_by_embedding` filters `WHERE embedding IS NOT NULL`. `supabase/migrations/005_community_samples.sql:7`
- **`script_preview` is `GENERATED ALWAYS ... STORED`** — never write to it directly; it auto-derives from `script`. Select it (not `script`) for list views.
- **Apply via `db query --linked`, not `db push`.** Per the project's Supabase CLI note, direct Postgres is network-blocked; migration `009`'s header documents `supabase db query --linked < ...`. See [lessons.md](../../lessons.md).
- **There is no `down`/rollback.** Migrations are forward-only and idempotent; to change a policy, `DROP POLICY IF EXISTS` then recreate (the `007` pattern).

## Change checklist

When altering the schema:

1. Add a new numbered migration file `00N_*.sql` (forward-only); never edit an applied one.
2. Make it idempotent: `IF NOT EXISTS` for tables/columns/indexes, `pg_policies` guard or `DROP POLICY IF EXISTS` for policies, `ON CONFLICT DO NOTHING` for bucket seeds.
3. Enable RLS on every new table and write per-action policies using `(select auth.uid())`.
4. Index every new foreign key (mirror migration `008`).
5. If adding counters, expose a `SECURITY DEFINER` RPC; don't let clients mutate counts directly.
6. Update the Supabase JS client types/queries in [database](../lib/database.md) and, for samples, [community](../lib/community.md).
7. For embeddings, keep the dimension (`1536`) in sync with the embedding model used by the community pipeline.
8. Apply with `supabase db query --linked < supabase/migrations/00N_*.sql`.

## Sources

- `supabase/migrations/001_profiles_likes_versions.sql`
- `supabase/migrations/002_user_settings.sql`
- `supabase/migrations/003_credits.sql`
- `supabase/migrations/004_free_credits.sql`
- `supabase/migrations/005_community_samples.sql`
- `supabase/migrations/006_sketch_samples_and_storage.sql`
- `supabase/migrations/007_fix_rls_performance_lints.sql`
- `supabase/migrations/008_index_foreign_keys.sql`
- `supabase/migrations/009_script_preview.sql`
