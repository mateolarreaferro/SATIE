---
title: API endpoints — ai & generate-audio
subsystem: api
sources:
  - api/ai.ts
  - api/generate-audio.ts
synced_sha: e54438c6b578
synced: 2026-05-31
related: [../lib/ai-providers.md, ../lib/ai-pipeline.md]
---

# API endpoints — ai & generate-audio

## Purpose

Two Vercel serverless functions that proxy paid third-party AI/audio APIs behind Supabase auth and a per-user credit balance, so the browser never holds provider keys.

## Why it exists / responsibilities

The client must never ship `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, or `ELEVENLABS_API_KEY`. These endpoints hold those keys server-side (env vars only) and gate every call on:

1. **Auth** — a valid Supabase JWT (`Authorization: Bearer <token>`).
2. **Credits** — a positive `balance_cents` row in the Supabase `credits` table.

`/api/ai` additionally owns **provider routing with automatic fallback** and **token-based cost accounting**. `/api/generate-audio` owns ElevenLabs sound generation at a flat per-call price.

## Mental model

```
browser ──Bearer JWT──> [endpoint] ──auth──> Supabase.auth.getUser
                              │
                              ├─ checkCredits (balance_cents > 0?)  → 402 if empty
                              ├─ call provider(s) with server key
                              ├─ deductCredits (best-effort)
                              └─ return result
```

`/api/ai` tries providers in an ordered list and falls through on any failure; `/api/generate-audio` calls exactly one upstream (ElevenLabs).

## Key types & functions

### `/api/ai` — `api/ai.ts`

- `handler(req, res)` — default export, the Vercel function entry. `api/ai.ts:185`
  - `OPTIONS` → 200 (CORS preflight). `api/ai.ts:189`
  - `GET` → `{ providers: AVAILABLE_PROVIDERS }` so the UI can render the provider selector. No auth required for GET. `api/ai.ts:192`
  - `POST` → auth → credits → provider fallback loop.
- `AVAILABLE_PROVIDERS` — derived at module load from which `KEYS` env vars are non-empty. `api/ai.ts:26`
- `PRICING` — per-model `{ input, output }` dollars per million tokens. `api/ai.ts:31`
- `DEFAULT_MODELS` — provider → default model id when `body.model` is omitted. `api/ai.ts:40`
- `calculateCostCents(provider, model, data)` — reads usage fields from the provider-specific response shape, returns cents, floored at 1. Unknown model → returns 1. `api/ai.ts:46`
- `extractText(provider, data)` — pulls the completion text out of each provider's response JSON. `api/ai.ts:70`
- `callProvider(provider, body)` — issues the upstream `fetch` for anthropic / openai / gemini, mapping the shared request shape to each API. `api/ai.ts:79`
- `authenticateUser(req)` → userId | null. `api/ai.ts:146`
- `checkCredits(userId)` → error string | null. `api/ai.ts:155`
- `deductCredits(userId, costCents)` — upsert `balance_cents = max(0, current - cost)`. `api/ai.ts:168`

**POST request body** (`api/ai.ts:5`): `{ provider?, systemPrompt, messages, maxTokens?, temperature?, model? }`. `systemPrompt` and `messages` are required (else 400). `maxTokens` is clamped to ≤ 4096 (default 2048).

**POST success response** (`api/ai.ts:250`): `{ text, provider, cost_cents, warnings? }`. `provider` is the one that actually served the request (may differ from requested, due to fallback); `warnings` lists failed providers when fallback occurred.

### `/api/generate-audio` — `api/generate-audio.ts`

- `handler(req, res)` — default export. POST only (plus OPTIONS). `api/generate-audio.ts:71`
- `ELEVENLABS_COST_PER_GENERATION_CENTS` — flat 1 cent per call, independent of duration. `api/generate-audio.ts:22`
- `calculateAudioCostCents(_durationSeconds)` — returns the flat cent value (arg ignored). `api/generate-audio.ts:24`
- `authenticateUser` / `checkCredits` / `deductCredits` — same shape as `/api/ai`'s (duplicated, not shared). `api/generate-audio.ts:28`, `:41`, `:55`

**POST request body** (`api/generate-audio.ts:92`): `{ prompt, duration?, influence?, outputFormat? }`. `prompt` required (else 400). `duration` clamped to ≤ 22s (default 5), `influence` default 0.3, `outputFormat` default `mp3_44100_192`.

**POST success response**: raw `audio/mpeg` binary (a `Buffer`), with `Content-Length` set. `api/generate-audio.ts:126`

## Data flow

**Inbound:** the browser's AI layer calls these. `POST /api/ai` is the upstream behind the provider abstraction in [ai-providers](../lib/ai-providers.md), consumed by the generation pipeline in [ai-pipeline](../lib/ai-pipeline.md) (`generateCode`, `verifyAndRepair`, sample-spec generation). `GET /api/ai` feeds the provider `<select>` in `AIPanel.tsx`. `POST /api/generate-audio` is called by `AudioGen.ts` (ElevenLabs generation + IndexedDB cache).

**Outbound:** `/api/ai` → `api.anthropic.com/v1/messages`, `api.openai.com/v1/chat/completions`, or `generativelanguage.googleapis.com/.../:generateContent`. `/api/generate-audio` → `api.elevenlabs.io/v1/sound-generation`. Both → Supabase (`auth.getUser`, `credits` table) via the **service-role** key.

**Provider fallback order** (`api/ai.ts:215`): if `body.provider` is set and configured, it goes first, then the remaining `AVAILABLE_PROVIDERS`; otherwise the natural order. Each provider is tried until one returns a non-empty `text`; an upstream non-OK status or empty body pushes an error and `continue`s to the next.

## Invariants & gotchas

- **Keys are server-only.** Every provider/ElevenLabs key comes from `process.env`; nothing accepts a key from the request. Never echo keys back.
- **Supabase URL/service-key resolution:** `VITE_SUPABASE_URL || SUPABASE_URL`, plus `SUPABASE_SERVICE_ROLE_KEY`. `generate-audio` returns `null` from auth (→ 401) if either is missing; `ai.ts` does not pre-check them.
- **Status code contract:** 401 unauthenticated, 402 no credits, 400 missing fields, 405 wrong method, 503 nothing configured (no providers / no ElevenLabs key), 502 all providers failed or ElevenLabs non-OK, 500 unexpected throw.
- **`deductCredits` is best-effort** — both endpoints `.catch(() => {})` it, so a credit-write failure never blocks returning a successful result. Billing is not transactional: check-then-deduct has a race window, and credits are deducted *after* the upstream succeeds.
- **`maxTokens` and `duration` are hard-clamped** server-side (4096 tokens, 22s audio) regardless of what the client requests.
- **`calculateCostCents` floors at 1 cent** and returns 1 for any model absent from `PRICING` (incl. `gemini-2.0-flash-lite`, which is priced at 0) — so every AI call costs at least 1 cent.
- **Auth/credits helpers are copy-pasted** across the two files, not imported from a shared module — fixes must be applied in both.
- **CORS is `*`** with `Content-Type, Authorization` headers allowed; `/api/ai` allows `GET, POST, OPTIONS`, `/api/generate-audio` only `POST, OPTIONS`.
- **Provider response shapes diverge** — `extractText` and `calculateCostCents` switch on provider name to read the right JSON path and usage fields; adding a provider means updating both plus `KEYS`, `PRICING`, `DEFAULT_MODELS`, and `callProvider`.

## Change checklist

- **Add an AI provider:** extend `KEYS` (`api/ai.ts:19`), `DEFAULT_MODELS`, `PRICING`, and add cases to `callProvider`, `extractText`, and `calculateCostCents`. Mirror the client side in [ai-providers](../lib/ai-providers.md) and the `AIPanel.tsx` selector (see CLAUDE.md "Adding a new AI provider").
- **Change a model / price:** update `PRICING` and `DEFAULT_MODELS` together so cost accounting stays correct.
- **Change request/response shape:** update the consumers — `lib/aiProvider.ts` / `lib/aiGenerate.ts` for `/api/ai`, `AudioGen.ts` for `/api/generate-audio` — and the doc pages listed in `related`.
- **Touch auth/credits logic:** edit the helpers in **both** `api/ai.ts` and `api/generate-audio.ts`.
- Per `.claude/rules/wiki.md`, edit this page in the same commit as any change to the sources below.

## Sources

- `api/ai.ts`
- `api/generate-audio.ts`
