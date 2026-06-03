---
title: lib — shared services overview
subsystem: lib
sources: []
synced_sha: pending
synced: 2026-05-30
related: [ai-pipeline.md, ai-providers.md, database.md, auth.md, community.md, storage-cache.md, performance.md, audio-analysis.md]
---

## Purpose

`src/lib/` is the grab-bag of framework-light shared services — AI generation, Supabase data/auth, the community sample library, caching, and code-splitting — that sit between the React UI and external services.

## Why it exists / responsibilities

`lib/` is neither the audio engine nor the React app. It holds the cross-cutting concerns both depend on, kept as plain functions and clients so they can be unit-tested and reused across pages:

- **AI generation** — the provider-agnostic LLM abstraction and the full prompt→generate→verify→repair pipeline that turns a natural-language prompt into a `.satie` script ([ai-providers](./ai-providers.md), [ai-pipeline](./ai-pipeline.md)).
- **Data & auth** — the singleton Supabase client, the OAuth `AuthProvider`/`useAuth` context, and the CRUD wrappers for sketches, profiles, likes, versions, and user settings ([database](./database.md), [auth](./auth.md)).
- **Community library** — crowdsourced CC0 samples: upload, tagging, embedding, and hybrid (tag/text/vector) search ([community](./community.md)).
- **Storage & caching** — IndexedDB sample/trajectory caches, Supabase Storage for sketch samples + thumbnails, and a localStorage TTL query cache ([storage-cache](./storage-cache.md)).
- **Performance** — `lazyWithRetry`/`lazyRoute` code-splitting and route-chunk preloading that keep first navigation fast ([performance](./performance.md)).
- **Audio analysis** — pure feature extraction over an `AudioBuffer` (RMS, peak, centroid) for tagging/visuals ([audio-analysis](./audio-analysis.md)).

Most of `lib/` is plain TypeScript. Only `AuthContext.tsx` and the `lazy*` helpers touch React; everything else is callable from a test or a worker.

## Mental model

`lib/` is a fan-out layer. The UI calls into it; it calls out to Supabase, the AI proxy/providers, IndexedDB, and the browser.

```
            ui/ pages + components + hooks
                        │
                        ▼
   ┌──────────────────────────────────────────────┐
   │                  src/lib/                      │
   │  ai-*  data/auth  community  storage/cache  …  │
   └──────────────────────────────────────────────┘
        │            │           │            │
        ▼            ▼           ▼            ▼
   AI proxy /    Supabase    Supabase      IndexedDB /
   providers     (DB+Auth)   Storage       localStorage
```

Each sibling page documents one slice of that box; this page is the index.

## Key types & functions

This is a hub — it owns no code. The load-bearing entry points per slice (verify against the file):

- **AI pipeline** — `generateCode(prompt, currentScript, loadedSamples, history)` at src/lib/aiGenerate.ts:562 runs the full pipeline (route fast/full provider → `checkLibrary` → `buildSystemPrompt` + `buildEnrichedPrompt` → `callAI` → `cleanGeneratedCode` → `verifyAndRepair`). Also `generateSampleSpec` (src/lib/aiGenerate.ts:604), `generateEnsemble` (src/lib/aiGenerate.ts:792), `refineScript` (src/lib/aiGenerate.ts:860), `scoreScript` (src/lib/aiGenerate.ts:654). See [ai-pipeline](./ai-pipeline.md).
- **AI providers** — `createProvider` (src/lib/aiProvider.ts:426), `createFastProvider` (src/lib/aiProvider.ts:453), `createSmartProvider` (src/lib/aiProvider.ts:500), the `AIProvider` interface (src/lib/aiProvider.ts:34) with `Anthropic`/`OpenAI`/`Gemini`/`Proxied` impls, plus session cost/budget tracking (`trackCost` src/lib/aiProvider.ts:62, `checkBudget` src/lib/aiProvider.ts:100). See [ai-providers](./ai-providers.md).
- **Data & auth** — `supabase` client (src/lib/supabase.ts:13) and the `Sketch`/`SketchListItem`/`Profile`/`SketchVersion`/`SketchLike` interfaces; sketch CRUD (`getSketch` src/lib/sketches.ts:23 … `forkSketch` src/lib/sketches.ts:142); `AuthProvider` (src/lib/AuthContext.tsx:60) + `useAuth` (src/lib/AuthContext.tsx:115); `loadSettings`/`saveKey`/`saveSettings` (src/lib/userSettings.ts:35); `feedbackStore` (`saveFeedback` src/lib/feedbackStore.ts:97, `getTopExamples` src/lib/feedbackStore.ts:136). See [database](./database.md) and [auth](./auth.md).
- **Community** — `uploadCommunitySample` (src/lib/communitySamples.ts:62), search trio `searchByTags`/`searchByText`/`searchByEmbedding` (src/lib/communitySamples.ts:219/238/255), `searchCommunity` (src/lib/communitySearch.ts:40), `suggestTags`/`computeEmbedding` (src/lib/communityTagging.ts:36/90). See [community](./community.md).
- **Storage & cache** — IndexedDB caches `getCachedSample`/`cacheSample` (src/lib/sampleCache.ts:25/41), `cacheTrajectory`/`getCachedTrajectory` (src/lib/trajectoryCache.ts:35/51); Supabase Storage `uploadSketchSamples`/`loadSketchSamples` (src/lib/sampleStorage.ts:58/117), `captureCanvasThumbnail`/`uploadThumbnail` (src/lib/thumbnailCapture.ts:13/46); TTL `cachedQuery` (src/lib/queryCache.ts:74). See [storage-cache](./storage-cache.md).
- **Performance** — `lazyWithRetry` (src/lib/lazyWithRetry.ts:39), `lazyRoute` (src/lib/lazyWithRetry.ts:76), `preloadRoute`/`preloadCommonRoutes` (src/lib/routePreload.ts:43/57). See [performance](./performance.md).
- **Audio analysis** — `analyzeAudioBuffer(buffer): AudioFeatures` (src/lib/audioAnalysis.ts:21). See [audio-analysis](./audio-analysis.md).

## Data flow

**Callers in (ui → lib):** pages and components import these directly — [Chat](../ui/chat.md) and the [AI panel](../ui/ai-panel.md) call `generateCode`; [pages](../ui/pages.md) (Dashboard, Editor, SketchView, Gallery) call the sketch/profile/likes CRUD; the [community UI](../ui/community-ui.md) calls the community functions; `main.tsx` and route components call the `lazy*`/preload helpers; the editor's save path calls sample/thumbnail storage. `AuthProvider` wraps the whole app in `main.tsx`.

**Calls out (lib → services):** the Supabase singleton (src/lib/supabase.ts:13) backs DB, auth, and Storage; AI providers hit the per-provider HTTP APIs (with user keys) or fall back to the `/api/ai/*` proxy ([api](../api/_index.md)); caches read/write IndexedDB and localStorage; `analyzeAudioBuffer` is pure (no I/O).

Within `lib/` itself: `aiGenerate` calls `aiProvider` (provider selection + cost), `feedbackStore` (top examples / anti-patterns), and `communitySearch` (sample availability for the prompt). The [engine](../engine/_index.md) is **not** imported here — AI output is verified via the engine's `tryParse` barrel export inside `verifyAndRepair`, the only engine touchpoint.

## Invariants & gotchas

- **Provider selection prefers the user's own key, else the proxy.** `createProvider` (src/lib/aiProvider.ts:426) sorts the preferred provider first, picks the first one with a stored key from localStorage (`satie-anthropic-key` / `satie-openai-key` / `satie-gemini-key`), and only falls back to `ProxiedProvider` when no user key exists. API keys are never committed (CLAUDE.md).
- **Fast vs full model is prompt-routed.** `generateCode` calls `isComplexPrompt` (src/lib/aiProvider.ts:470) and uses `createFastProvider` (Haiku-class, 1024 tokens) for tweaks, `createProvider` (Sonnet-class, 2048 tokens) for from-scratch builds.
- **Supabase client never throws on missing env.** It falls back to a placeholder URL/key (src/lib/supabase.ts:13) so CI/tests don't crash — but real calls fail; check `.env`.
- **`AuthProvider` peeks localStorage synchronously** (`hasStoredSession`, src/lib/AuthContext.tsx) to skip the initial loading screen for signed-out visitors without a network RTT.
- **AI repair uses the engine, not a second LLM pass blindly.** `verifyAndRepair` parses with the engine's `tryParse`; only on failure does it call a fast provider to repair (see [ai-pipeline](./ai-pipeline.md)).
- **`lazyRoute` import specifiers must match `main.tsx` exactly** so the browser reuses the cached chunk — see [performance](./performance.md) and lessons #1–#5 (routing/bundling) in [lessons.md](../../lessons.md). Editor is intentionally excluded from `preloadCommonRoutes` because it drags in Three.js (~861KB) — lesson #3.
- **Theme tokens, not hardcoded hex, in any React-touching file** (`AuthContext` is the only component here) — lesson #8 in [lessons.md](../../lessons.md).

## Change checklist

- New `lib/` source file → add it to the best-fit sibling page's `sources:` list, or `npm run wiki:check` fails (`.claude/rules/wiki.md`). This `_index.md` carries no `sources`, so it is not auto-flagged — update its "Key types & functions" and the `related:` list by hand when you add a slice.
- Changed an existing service → update its covering sibling page in the same commit (the gate names it).
- New AI provider → follow the 5-step recipe in CLAUDE.md and update [ai-providers](./ai-providers.md).
- New Supabase table/column → update [database](./database.md) and `docs/wiki/data/schema.md`.

## Sources

- (hub page — no source files; see the sibling pages listed in `related:`)
