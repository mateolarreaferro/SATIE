---
title: Community samples, search, tagging, feedback
subsystem: lib
sources:
  - src/lib/communitySamples.ts
  - src/lib/communitySearch.ts
  - src/lib/communityTagging.ts
  - src/lib/feedbackStore.ts
synced_sha: a1b5b0a98694
synced: 2026-05-31
related: [database.md, ../ui/community-ui.md]
---

## Purpose

Client-side CRUD, multi-modal search, AI auto-tagging, and RLHF feedback storage for the crowdsourced community sample library and AI generations.

## Why it exists / responsibilities

- Upload/download/delete shared audio samples in the `community-samples` Supabase Storage bucket, backed by the `community_samples` metadata table.
- Search that table three ways — tags (array overlap), full-text (RPC), semantic (pgvector RPC) — and fuse the results into one ranked list for the AI generation pipeline.
- Auto-tag uploaded samples by feeding filename + acoustic features to a fast AI provider, and compute text embeddings for semantic search.
- Persist human feedback on AI generations (explicit thumbs + implicit edit/undo/regen signals) in IndexedDB, scoring it so the best examples seed future prompts and the worst become anti-patterns.

## Mental model

The list-vs-search split is the central idea. List queries fetch a fixed column set (`COMMUNITY_LIST_COLS`, `communitySamples.ts:19`) that **deliberately omits the 1536-dim `embedding` vector** (~6KB/row). The embedding only ever leaves the DB server-side, inside the search RPCs; the client never downloads it.

```
list/popular/recent ─► COMMUNITY_LIST_COLS (no embedding) ─► CommunitySample[]
search (semantic) ───► RPC search_community_by_embedding ──► CommunitySample[] (+similarity)
                          embedding stays server-side
```

`searchCommunity` is the fan-out: it runs tag + text + semantic searches in parallel, merges by `id`, and re-ranks by how many searches a sample appeared in (then by `download_count`).

## Key types & functions

**communitySamples.ts**
- `CommunitySample` interface — sample row shape; `embedding` is absent (`communitySamples.ts:22`).
- `COMMUNITY_LIST_COLS` — explicit column list excluding `embedding` (`communitySamples.ts:19`).
- `uploadCommunitySample(params)` — dedup by 64KB SHA-256 content hash, 20-uploads/hour rate limit, storage upload then metadata insert (with storage cleanup on DB failure) (`communitySamples.ts:62`).
- `updateSampleEmbedding(sampleId, embedding)` — patch the `embedding` column post-tagging (`communitySamples.ts:145`).
- `downloadCommunitySample(sample)` — IndexedDB cache → storage download → `increment_community_download` RPC (`communitySamples.ts:158`).
- `downloadCommunitySampleByName(name)` — lazy load by name for the engine (`communitySamples.ts:185`).
- `deleteCommunitySample(sample)` — owner-only storage + row delete (`communitySamples.ts:205`).
- `searchByTags(tags, limit)` — `.overlaps('tags', tags)`, ordered by downloads (`communitySamples.ts:219`).
- `searchByText(query, limit)` — `search_community_samples` RPC (`communitySamples.ts:238`).
- `searchByEmbedding(embedding, limit, threshold)` — `search_community_by_embedding` RPC, cosine similarity (`communitySamples.ts:255`).
- `getPopularSamples(limit)` / `getPopularSampleNames(limit)` — sessionStorage-cached via `cachedQuery` (5 min / 10 min) (`communitySamples.ts:272`, `communitySamples.ts:289`).
- `getRecentSamples`, `getUserCommunitySamples`, `getCommunitySample`, `getPopularTags`, `getCommunityCount` (`communitySamples.ts:303`–`communitySamples.ts:368`).

**communitySearch.ts**
- `searchCommunity(prompt, soundKeywords, limit)` — fused tag+text+semantic search; 1-min LRU cache (max 50 entries), dedup + multi-hit re-rank (`communitySearch.ts:40`).
- `findCommunityMatch(prompt)` — extract >2-char words from a gen prompt, take top result's audio (`communitySearch.ts:107`).
- `formatCommunitySamplesForPrompt(samples)` — renders `community/<name> (tags: ...)` lines for the AI system prompt (`communitySearch.ts:124`).

**communityTagging.ts**
- `TagSuggestion` interface — `{ tags, description }` (`communityTagging.ts:9`).
- `suggestTags(filename, features)` — fast-provider call returning JSON; on parse failure falls back to filename tokens (`communityTagging.ts:36`).
- `computeEmbedding(name, description, tags)` — POSTs `{action:'embed', text}` to `/api/ai`; returns `number[] | null` (`communityTagging.ts:90`).

**feedbackStore.ts**
- `StoredFeedback` interface — prompt/output/target, explicit `rating`, implicit signals, computed `score` (`feedbackStore.ts:14`).
- `computeScore(entry)` — weighted: rating·0.5 + (1−editDistance)·0.3 + undo/regen penalty −0.2 + recency decay over 30 days (`feedbackStore.ts:38`).
- `editDistanceRatio(a, b)` — line-level Levenshtein ratio (0=identical, 1=different) (`feedbackStore.ts:50`).
- `saveFeedback`, `updateFeedback` — IndexedDB writes; `updateFeedback` recomputes `score` (`feedbackStore.ts:97`, `feedbackStore.ts:112`).
- `getTopExamples(target, limit)` — `score > 0`, descending (`feedbackStore.ts:136`).
- `getAntiPatterns(target, limit)` — `rating === -1`, ascending score (`feedbackStore.ts:158`).
- `createFeedbackEntry(prompt, output, target)` — fresh entry with default fields + initial score (`feedbackStore.ts:180`).

## Data flow

- **AI generation pipeline** ([aiGenerate](./ai-pipeline.md)) calls `searchCommunity` / `formatCommunitySamplesForPrompt` to surface relevant shared samples, and `getTopExamples` / `getAntiPatterns` to seed few-shot/negative examples in the system prompt.
- **Engine** calls `findCommunityMatch` / `downloadCommunitySampleByName` to substitute a community sample for an ElevenLabs gen block.
- `searchCommunity` calls `searchByTags` + `searchByText` + `searchByEmbedding`; the semantic branch first calls `computeEmbedding` (communityTagging) which hits the `/api/ai` `embed` action.
- `communitySamples` depends on `supabase`, `sampleCache` (IndexedDB), `queryCache` (`cachedQuery`); search RPCs and tables live in [database](./database.md).
- Community UI (upload, tagging confirm, browse) is [community-ui](../ui/community-ui.md).

## Invariants & gotchas

- **Never select `*` for list views** — use `COMMUNITY_LIST_COLS` to keep the 1536-dim embedding off the wire. `getCommunitySample` and `downloadCommunitySampleByName` use `*` intentionally (single row / lazy load).
- Embeddings are stored as `JSON.stringify(embedding)` strings, not raw arrays, on both insert and update.
- Dedup is content-hash based on the **first 64KB only** — different files sharing a 64KB head collide; the `embedding` is sent server-side only inside the RPC, never round-tripped to the client.
- `searchByText` / `searchByEmbedding` rely on DB-side RPCs (`search_community_samples`, `search_community_by_embedding`, `increment_community_download`) — adding a search mode means adding an RPC in [database](./database.md).
- `computeEmbedding` and `suggestTags` fail soft (return `null` / filename fallback); a missing embedding silently drops semantic search from `searchCommunity` rather than erroring.
- All `feedbackStore` IndexedDB ops are wrapped to be **non-fatal** — feedback persistence never breaks generation.
- `getTopExamples` only returns entries with `score > 0`; an entry with no rating still gets a small positive recency score, so unrated recent generations can leak in as examples.
- `searchCommunity`'s in-module LRU cache key is `prompt|sorted-tags`; identical prompts with reordered keywords still hit cache.

## Change checklist

- New list query → use `COMMUNITY_LIST_COLS`, not `*`.
- New search mode → add the Supabase RPC + a wrapper in `communitySamples.ts`, then wire it into `searchCommunity`'s fan-out and re-rank.
- New `CommunitySample` field → add to the interface, `COMMUNITY_LIST_COLS`, the upload `row`, and the DB schema in [database](./database.md).
- New feedback signal → extend `StoredFeedback`, adjust `computeScore` weights, and update `createFeedbackEntry` defaults.
- Changing `/api/ai` embed contract → update `computeEmbedding`'s request/response shape.

## Sources

- src/lib/communitySamples.ts
- src/lib/communitySearch.ts
- src/lib/communityTagging.ts
- src/lib/feedbackStore.ts
