---
title: Audio generation — AudioGen.ts (ElevenLabs + cache)
subsystem: engine
sources:
  - src/engine/audio/AudioGen.ts
synced_sha: 952ad9157501
synced: 2026-05-31
related: [../lib/ai-pipeline.md, ../api/endpoints.md]
---

## Purpose

Turns a text prompt into a decoded `AudioBuffer` via the ElevenLabs Sound Generation API, backed by an IndexedDB MP3 cache.

## Why it exists / responsibilities

Satie voices can reference AI-generated clips instead of user-uploaded samples. `AudioGen.ts` is the single place that:

- Calls ElevenLabs `/v1/sound-generation` (directly with the user's key, or through a server proxy when there is no key).
- Caches the returned MP3 bytes in IndexedDB so repeat plays / reloads don't re-spend credits.
- Decodes MP3 → `AudioBuffer` via the caller's `AudioContext`.
- Rate-limits and de-duplicates concurrent generation so a script with many gen voices doesn't hammer the API.

This is engine code: zero React, talks only to Web Audio, `fetch`, IndexedDB, and (lazily) the Supabase client.

## Mental model

One public function, `generateAudio`, with several short-circuits before it ever hits the network:

```
generateAudio(ctx, prompt, clipName, isLoop, opts)
  ├─ cache hit (exact key)        → decode & return
  ├─ cache hit (base prompt key)  → decode & return   (strips variation suffix)
  ├─ in-flight for clipName?      → reuse pending promise
  └─ miss → fetch (key ? direct : proxy)
              ├─ acquireSlot()  (max 3 concurrent)
              ├─ MP3 ArrayBuffer
              ├─ setCache(exactKey, mp3)
              └─ ctx.decodeAudioData(mp3.slice(0)) → AudioBuffer
```

Two layers of bookkeeping: `pending` (a `Map<clipName, Promise>`) dedups identical clips; `acquireSlot`/`releaseSlot` (a counter + FIFO queue) caps total concurrent API calls at 3.

## Key types & functions

- `interface GenOptions { duration?, influence? }` — per-call overrides — src/engine/audio/AudioGen.ts:17
- `generateAudio(ctx, prompt, clipName, isLoop, options?) → Promise<AudioBuffer>` — the only generation entry point — src/engine/audio/AudioGen.ts:103
- `clearAudioCache() → Promise<void>` — wipes the IndexedDB object store — src/engine/audio/AudioGen.ts:91

Internal (not exported):

- `acquireSlot()` / `releaseSlot()` — concurrency gate, `MAX_CONCURRENT = 3` — src/engine/audio/AudioGen.ts:30, src/engine/audio/AudioGen.ts:40
- `openCacheDB()` — opens DB `satie-audio-cache` v2, store `generated` — src/engine/audio/AudioGen.ts:48
- `cacheKey(prompt, duration, influence, clipName)` — `${prompt}|${duration}|${influence}|${clipName}` — src/engine/audio/AudioGen.ts:62
- `getCached(key)` / `setCache(key, data)` — both swallow errors (cache is best-effort) — src/engine/audio/AudioGen.ts:66, src/engine/audio/AudioGen.ts:81
- `fetchSoundGenerationRateLimited(...)` → wraps `fetchSoundGeneration` in a slot — src/engine/audio/AudioGen.ts:162
- `fetchSoundGeneration(apiKey, ...)` — direct ElevenLabs POST with `xi-api-key` header — src/engine/audio/AudioGen.ts:177
- `fetchSoundGenerationViaProxy(...)` — POST `/api/generate-audio` with Supabase Bearer JWT — src/engine/audio/AudioGen.ts:210

Constants: `LOOP_DURATION = 10`, `ONESHOT_DURATION = 5`, `PROMPT_INFLUENCE = 0.3` — src/engine/audio/AudioGen.ts:9.

## Data flow

**Callers (in):** the engine's gen-block playback path calls `generateAudio` when a voice references AI-generated audio. `clearAudioCache` is exposed for settings / cache-management UI.

**Callees (out):**
- ElevenLabs `POST https://api.elevenlabs.io/v1/sound-generation?output_format=...` (direct path).
- `POST /api/generate-audio` server proxy — see [api endpoints](../api/endpoints.md) — used when the user has no ElevenLabs key; requires a Supabase session JWT.
- `supabase.auth.getSession()` via a lazily imported shared client (`import('../../lib/supabase')`).
- `ctx.decodeAudioData` to produce the final `AudioBuffer`.

Prompt text usually originates from the [AI pipeline](../lib/ai-pipeline.md) (`generateSampleSpec` produces `{name, prompt}`), but `generateAudio` itself is provider-agnostic — it only sees the final string.

## Invariants & gotchas

- **Key selection:** `duration` defaults to `LOOP_DURATION` (10s) for loops, `ONESHOT_DURATION` (5s) otherwise; `influence` defaults to `0.3`. `output_format` is `mp3_44100_192` when `ctx.sampleRate >= 48000`, else `mp3_44100_128` (src/engine/audio/AudioGen.ts:114). `duration` and `influence` are part of the cache key, so changing them is a cache miss; sample rate / output format are **not** in the key.
- **Cache stores MP3, not PCM.** DB version was bumped to 2 for exactly this reason (src/engine/audio/AudioGen.ts:14). Decoding happens on every read.
- **`decodeAudioData` consumes its buffer.** Always pass `mp3Data.slice(0)` — a copy — or the cached/returned `ArrayBuffer` becomes detached. This is repeated at lines 120, 130, and 155.
- **Base-prompt fallback:** before generating, it strips a trailing variation suffix (e.g. `, with subtle variation`, `, alternative take`) and checks the cache under that base key (src/engine/audio/AudioGen.ts:125). This reuses audio when a script is regenerated with cosmetically different prompts. The list of suffixes is a hardcoded regex — keep it in sync with whatever the AI pipeline appends.
- **De-dup key is `clipName`, not the cache key.** Two concurrent requests with the same `clipName` share one promise even if prompts differ; the `pending` entry is cleared in a `finally`. Only the exact-key entry is written to the cache on success (the base key is read-only).
- **Concurrency cap is process-wide.** `activeRequests` / `requestQueue` are module-level singletons; the limit of 3 spans all in-flight generations regardless of caller. The proxy path also acquires a slot.
- **No key → proxy → spends credits.** With no `satie-elevenlabs-key` in localStorage it logs a warning and routes through the proxy (~1¢/voice). The proxy throws a sign-in error if there's no Supabase session.
- **All cache ops fail silently.** `getCached` returns `null`, `setCache`/`clearAudioCache` no-op on error — generation still proceeds without a cache.

## Change checklist

- Changing the cache key shape (`cacheKey`) or what's stored → bump `DB_VERSION` and consider migration; old keys silently miss.
- Adding fields to `GenOptions` → thread them into both `generateAudio` defaults and the cache key if they affect output.
- Editing the variation-suffix regex → mirror the suffix strings the AI pipeline (`generateSampleSpec` / prompt builders in [ai-pipeline](../lib/ai-pipeline.md)) actually emits.
- Changing the proxy request body → update the `/api/generate-audio` handler ([api endpoints](../api/endpoints.md)) in the same commit.
- Run `npm run test` after any engine change (per engine rules).

## Sources

- src/engine/audio/AudioGen.ts
