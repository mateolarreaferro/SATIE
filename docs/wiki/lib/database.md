---
title: Database — Supabase client, sketches, versions, profiles, likes
subsystem: lib
sources:
  - src/lib/supabase.ts
  - src/lib/sketches.ts
  - src/lib/versions.ts
  - src/lib/profiles.ts
  - src/lib/likes.ts
  - src/lib/queryCache.ts
synced_sha: e58d55bb4005
synced: 2026-05-31
related: [auth.md, community.md, ../data/schema.md]
---

## Purpose

The persistence layer: the shared Supabase client plus the CRUD/query helpers for sketches, version snapshots, profiles, and likes, fronted by a TTL'd sessionStorage cache for list views.

## Why it exists / responsibilities

- **One Supabase client.** `supabase.ts` constructs a single `createClient` instance imported everywhere — no per-module clients.
- **Row-type definitions.** All DB row interfaces (`Sketch`, `SketchListItem`, `Profile`, `SketchVersion`, `SketchLike`) live in `supabase.ts` so callers share one source of truth.
- **List vs. full reads.** Grid/list views fetch a slimmed-down shape that omits the multi-KB `script` body; Editor/detail views fetch the full row. These are distinct functions, not flags.
- **Counter maintenance.** Like and fork counts are denormalized columns on `sketches`, kept current via Postgres RPCs (`increment_like_count`, `decrement_like_count`, `increment_fork_count`) fired fire-and-forget.
- **Instant back/forward nav.** `queryCache.ts` caches list results in sessionStorage with a TTL; create/update/delete/fork invalidate the relevant keys.

## Mental model

```
UI page  ──calls──>  sketches.ts / versions.ts / profiles.ts / likes.ts
                          │
                          ├─ list reads ──> cachedQuery ──(miss)──> supabase ──> Postgres
                          │                    (sessionStorage, TTL)
                          └─ full reads / writes ───────────────────> supabase ──> Postgres
                                                       │
                                                       └─ writes also call invalidateCache(...)
```

- `Sketch` = full row (has `script`). `SketchListItem` = same minus `script`, plus a server-generated `script_preview` (first 200 chars, generated column). See `supabase.ts:33`.
- Cache keys are derived per scope (per-user, public, per-user-public). Writes blow away whichever keys could now be stale.

## Key types & functions

Client & types (`supabase.ts`):
- `supabase` — the shared client; falls back to placeholder URL/key when env vars are missing so `createClient` does not throw in CI/test — src/lib/supabase.ts:13
- `Sketch` (full, has `script`) — src/lib/supabase.ts:18
- `SketchListItem` (omits `script`, requires `script_preview`) — src/lib/supabase.ts:38
- `Profile` — src/lib/supabase.ts:51
- `SketchVersion` — src/lib/supabase.ts:60
- `SketchLike` — src/lib/supabase.ts:69

Sketch CRUD (`sketches.ts`):
- `getSketch(id)` — full row, `maybeSingle`, returns null on error — src/lib/sketches.ts:23
- `getPublicSketch(id)` — full row gated on `is_public = true` — src/lib/sketches.ts:38
- `getUserSketchesList(userId)` — cached list, `LIST_COLS` only, `limit(200)`, 30s TTL — src/lib/sketches.ts:54
- `getPublicSketchesList()` — cached list, `limit(50)`, 60s TTL — src/lib/sketches.ts:69
- `getUserPublicSketchesList(userId)` — cached list for profile pages, `limit(100)`, 30s TTL — src/lib/sketches.ts:84
- `createSketch(userId, title, script)` — insert + invalidate user caches — src/lib/sketches.ts:99
- `updateSketch(id, updates)` — partial update (`title`/`script`/`is_public`), stamps `updated_at`, invalidates by returned `user_id` — src/lib/sketches.ts:115
- `deleteSketch(id)` — reads `user_id` first, deletes, then invalidates — src/lib/sketches.ts:131
- `forkSketch(userId, sketch)` — inserts a copy with `forked_from`, fires `increment_fork_count` RPC, invalidates both forker and source caches — src/lib/sketches.ts:142
- `LIST_COLS` (the column projection for list reads) — src/lib/sketches.ts:4
- `invalidateUserCaches(userId)` (internal; clears user, user-public, and public keys) — src/lib/sketches.ts:14

Versions (`versions.ts`):
- `saveVersion(sketchId, title, script)` — computes next `version_number` via a `count` query, then inserts; called on explicit save, not autosave — src/lib/versions.ts:7
- `getVersions(sketchId)` — newest-first, `limit(50)` — src/lib/versions.ts:38
- `getVersion(versionId)` — single version, null on error — src/lib/versions.ts:53

Profiles (`profiles.ts`):
- `getProfile(userId)` — single by id — src/lib/profiles.ts:3
- `getProfilesByIds(ids)` — batched fetch; dedups ids with a `Set`, one `.in('id', ...)` round-trip, returns a `Record<id, Profile>` (missing ids simply absent), `{}` for empty input — src/lib/profiles.ts:25
- `getProfileByUsername(username)` — single by username — src/lib/profiles.ts:46
- `upsertProfile(userId, updates)` — upsert keyed on `id` — src/lib/profiles.ts:64

Likes (`likes.ts`):
- `likeSketch(userId, sketchId)` — insert; swallows unique-violation `23505` (already liked), then fires `increment_like_count` RPC — src/lib/likes.ts:3
- `unlikeSketch(userId, sketchId)` — delete by composite key, fires `decrement_like_count` RPC — src/lib/likes.ts:18
- `hasUserLiked(userId, sketchId)` — head count query → boolean, false on error — src/lib/likes.ts:31
- `getSketchLikeCount(sketchId)` — head count query → number, 0 on error — src/lib/likes.ts:42

Query cache (`queryCache.ts`):
- `cachedQuery(key, ttlMs, fn)` — returns fresh cached value (no network) or awaits `fn()` and stores it — src/lib/queryCache.ts:74
- `readCache(key)` — returns stored value, lazily evicting on expiry; null if missing/expired/unparseable — src/lib/queryCache.ts:24
- `writeCache(key, value, ttlMs)` — stores `{value, expires}`, drops silently if storage is full — src/lib/queryCache.ts:41
- `invalidateCache(keyOrPrefix, prefix?)` — removes one key, or every key with a prefix when `prefix = true` — src/lib/queryCache.ts:51

## Data flow

- **Callers in:** Dashboard, Editor, SketchView, Gallery, UserProfile, and Embed pages call the sketch/profile/like/version helpers. The likes UI on `SketchView`/`Embed` calls `likeSketch`/`unlikeSketch`/`hasUserLiked`. `VersionsPanel` drives `saveVersion`/`getVersions`/`getVersion`.
- **Auth dependency:** `userId` arguments come from the authenticated session managed by [auth](./auth.md) (`AuthContext`).
- **Calls out:** every helper goes through the shared `supabase` client to Postgres. Counter mutations go through Postgres RPC functions. List reads pass through `queryCache` first.
- **Community features** ([community](./community.md)) read profiles in bulk via `getProfilesByIds` to attribute sketches/samples without N+1 round-trips.
- **Schema reference:** column/table definitions and the generated `script_preview` column are described in [schema](../data/schema.md).

## Invariants & gotchas

- **List reads must never select `script`.** Use `LIST_COLS`; transferring full bodies for grids is the exact regression these functions avoid. Reach for `getSketch`/`getPublicSketch` only when the body is actually rendered.
- **`script_preview` is server-generated.** It is a generated column (first 200 chars of `script`) — never write it from the client.
- **Cache invalidation must match the write's scope.** Any mutation that changes a user's list, the public list, or a user's public list must call `invalidateUserCaches`. `updateSketch` invalidates by the row's returned `user_id`; `deleteSketch` reads `user_id` first because the row is gone after delete; `forkSketch` invalidates both the forker and the source owner.
- **Counter RPCs are fire-and-forget.** `increment_like_count` / `decrement_like_count` / `increment_fork_count` are not awaited and their failures are swallowed, so the denormalized `like_count`/`fork_count` can drift from the `sketch_likes` row truth. `getSketchLikeCount` returns the authoritative count.
- **Double-like is tolerated.** `likeSketch` treats Postgres unique violation `23505` as success (idempotent), relying on RLS/unique constraint rather than a pre-check.
- **`cachedQuery` is not stale-while-revalidate by itself.** On a hit it returns cached with no background refresh. Callers wanting SWR must pair a synchronous `readCache()` with a parallel `cachedQuery()` (see the module doc comment).
- **Cache is best-effort.** All `queryCache` functions degrade silently when `sessionStorage` is absent (SSR/CI) or full — they never throw.
- **Read errors return empty, not throws.** Most getters log and return `null`/`{}`/`0` on error; write paths (`createSketch`, `updateSketch`, `deleteSketch`, `saveVersion`, `unlikeSketch`) throw and rely on the caller to handle it.

## Change checklist

- Adding a sketch column the list view needs? Update `LIST_COLS` (`sketches.ts:4`) **and** the `SketchListItem` interface (`supabase.ts:38`), plus [schema](../data/schema.md).
- Changing a row shape? Update the matching interface in `supabase.ts` (single source of truth for row types).
- Adding a write path? Make sure it calls `invalidateUserCaches` with the correct owner id(s).
- Adding a new cached list? Define a key helper + TTL near the others in `sketches.ts` and wire invalidation into every mutation that can stale it.
- Adding/renaming a counter RPC? Update the `.rpc(...)` call sites in `likes.ts` / `sketches.ts` and the corresponding Postgres function.

## Sources

- src/lib/supabase.ts
- src/lib/sketches.ts
- src/lib/versions.ts
- src/lib/profiles.ts
- src/lib/likes.ts
- src/lib/queryCache.ts
