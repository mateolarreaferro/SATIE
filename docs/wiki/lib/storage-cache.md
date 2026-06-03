---
title: Storage & caching — samples, trajectories, thumbnails, templates
subsystem: lib
sources:
  - src/lib/sampleCache.ts
  - src/lib/sampleStorage.ts
  - src/lib/trajectoryCache.ts
  - src/lib/thumbnailCapture.ts
  - src/lib/templates.ts
synced_sha: 470c7b8e9c60
synced: 2026-05-31
related: [database.md]
---

## Purpose

Persistence helpers for binary sketch assets: two client-side IndexedDB caches (audio samples, custom trajectories), Supabase Storage upload/download for samples, sketch thumbnail capture, and the built-in onboarding template list.

## Why it exists / responsibilities

- **Make repeated sample loads instant.** Raw audio `ArrayBuffer`s are large; caching them in IndexedDB avoids re-downloading from Supabase Storage on every play.
- **Make sketches self-contained for sharing.** On save, all engine audio buffers (including AI-generated audio) are uploaded to the `samples` bucket and tracked in the `sketch_samples` manifest table, so public viewers can play without API keys.
- **Persist custom/AI-generated trajectory LUTs** so they survive reloads and can be re-used across sketches.
- **Produce a small JPEG preview** of a sketch's 3D viewport for gallery/list display.
- **Seed the editor with example scripts** that each demonstrate one DSL feature.

## Mental model

Samples live in three tiers; reads check the cheapest first:

```
engine buffer (RAM)
   ↑ loadBuffer()
IndexedDB cache (satie-samples, keyed by storage_path)   ← getCachedSample
   ↑ on miss, download + backfill
Supabase Storage `samples` bucket  +  sketch_samples manifest table
```

Trajectories are simpler: a single IndexedDB store (`satie-trajectories`) keyed by trajectory `name`, no remote tier in this module.

## Key types & functions

**Sample IndexedDB cache** (`satie-samples` DB, store `samples`, values keyed externally):
- `getCachedSample(clipName)` → `ArrayBuffer | null` — src/lib/sampleCache.ts:25
- `cacheSample(clipName, data)` — src/lib/sampleCache.ts:41
- `removeCachedSample(clipName)` — src/lib/sampleCache.ts:57
- `listCachedSamples()` → `string[]` (keys) — src/lib/sampleCache.ts:73

**Supabase Storage for samples** (`samples` bucket, `sketch_samples` table):
- `SketchSample` interface (`filename` = clip name, `storage_path`, `size_bytes`, …) — src/lib/sampleStorage.ts:11
- `uploadSample(userId, sketchId, clipName, data)` — uploads to bucket + upserts manifest row — src/lib/sampleStorage.ts:22
- `uploadSketchSamples(userId, sketchId, samples: Map)` — uploads only clips not already in the manifest — src/lib/sampleStorage.ts:58
- `getSketchSamples(sketchId)` → `SketchSample[]` — manifest query — src/lib/sampleStorage.ts:77
- `downloadSample(sample)` → `ArrayBuffer` — cache-first, backfills cache on miss — src/lib/sampleStorage.ts:91
- `loadSketchSamples(sketchId, loadBuffer)` → loaded clip names — fan-out download + load into engine — src/lib/sampleStorage.ts:117
- `deleteSample(sample)` — removes from bucket + manifest — src/lib/sampleStorage.ts:142

**Trajectory IndexedDB cache** (`satie-trajectories` DB, store `trajectories`, `keyPath: 'name'`):
- `StoredTrajectory` interface — interleaved xyz `Float32Array` `points`, `pointCount`, `source: 'builtin' | 'generated' | 'custom'` — src/lib/trajectoryCache.ts:10
- `cacheTrajectory(traj)` — src/lib/trajectoryCache.ts:35
- `getCachedTrajectory(name)` → `StoredTrajectory | null` — src/lib/trajectoryCache.ts:51
- `listCachedTrajectories()` → `StoredTrajectory[]` — src/lib/trajectoryCache.ts:67
- `removeCachedTrajectory(name)` — src/lib/trajectoryCache.ts:83

**Thumbnail capture** (`thumbnails` bucket):
- `captureCanvasThumbnail()` → `Blob | null` — scales the first `<canvas>` to 400×300, JPEG quality 0.7 — src/lib/thumbnailCapture.ts:13
- `uploadThumbnail(supabase, userId, sketchId, blob)` → storage path | null — uploads to `{userId}/{sketchId}/thumbnail.jpg` — src/lib/thumbnailCapture.ts:46

**Templates**:
- `Template` interface (`title`, `description`, `script`) — src/lib/templates.ts:6
- `TEMPLATES` array — 3 example scripts (Spatial Rain, Rhythmic Pulse, Drone Landscape) — src/lib/templates.ts:12

## Data flow

- **Save path:** the editor/sketch save flow collects engine audio buffers into a `Map<clipName, ArrayBuffer>` and calls `uploadSketchSamples`; it also calls `captureCanvasThumbnail` + `uploadThumbnail`. The `sketch_samples` manifest rows and storage objects are created here.
- **Load path:** opening a sketch calls `loadSketchSamples(sketchId, loadBuffer)`, where `loadBuffer` is provided by the engine hook ([hooks](../ui/hooks.md)) to decode + register each `ArrayBuffer` as a named clip. Each `downloadSample` consults `getCachedSample` first.
- **AI-generated trajectories** (see [ai-pipeline](./ai-pipeline.md) / `TrajectoryGen`) and recorded/custom LUTs are persisted via `cacheTrajectory` and listed back into the asset UI via `listCachedTrajectories`.
- Supabase client comes from `./supabase`; row/table shapes (`sketch_samples`) belong to the [database](./database.md) schema. `uploadThumbnail` takes the supabase client as a structurally-typed argument rather than importing it.

## Invariants & gotchas

- **Two independent cache key spaces.** `sampleCache` is a low-level store keyed by whatever string the caller passes. `sampleStorage.downloadSample` deliberately keys the cache by `sample.storage_path` (`userId/sketchId/clipName`), **not** by bare clip name, so two sketches that share a clip name (e.g. `Audio/bird_6`) don't collide in the shared `satie-samples` DB — src/lib/sampleStorage.ts:92. Callers that cache by bare clip name elsewhere are in a different namespace by design.
- **Cache writes are best-effort.** `cacheSample`, `cacheTrajectory`, and the `remove*` helpers swallow errors (`catch {}`); a failed cache write is non-fatal and just means a future remote fetch. Read helpers resolve to `null`/`[]` on error rather than rejecting.
- **`uploadSketchSamples` only uploads missing clips.** It diffs against `getSketchSamples` by `filename`, so editing an existing clip's audio under the same name will **not** re-upload (the manifest already has the row). `uploadSample` itself uses `upsert: true` + `onConflict: 'sketch_id,filename'`, so a direct re-upload does overwrite.
- **Storage path encoding:** the clip name is `encodeURIComponent`-ed into the storage path but stored raw in `filename`. Compare/look up by `filename`, build bucket paths via `storage_path`.
- **`loadSketchSamples` is resilient per-sample:** a failed download/load is logged and skipped, not thrown — the returned list reflects only what actually loaded.
- **Thumbnail capture grabs `document.querySelector('canvas')`** — the *first* canvas in the DOM. It assumes the Three.js viewport canvas is that element; returns `null` if none exists.
- IndexedDB stores differ in keying: `samples` store has no `keyPath` (key passed to `put`), while `trajectories` uses `keyPath: 'name'` (key is the object's `name` field). Bumping `DB_VERSION` requires updating the matching `onupgradeneeded` store creation.

## Change checklist

- Changing `SketchSample` shape → update the `sketch_samples` table schema ([database](./database.md)) and any save/load callers.
- Changing the cache key scheme in `downloadSample` → audit every `getCachedSample`/`cacheSample` caller for namespace collisions.
- Bumping `DB_VERSION` in either cache → add the migration in `onupgradeneeded`.
- Adding a template → append to `TEMPLATES`; keep each script demonstrating one feature and valid against the [parser](../engine/parser.md).
- Changing thumbnail dimensions/format → update `THUMB_WIDTH`/`THUMB_HEIGHT`/quality and the `contentType` in `uploadThumbnail`.

## Sources

- src/lib/sampleCache.ts
- src/lib/sampleStorage.ts
- src/lib/trajectoryCache.ts
- src/lib/thumbnailCapture.ts
- src/lib/templates.ts
