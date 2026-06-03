---
title: AI providers — aiProvider.ts
subsystem: lib
sources:
  - src/lib/aiProvider.ts
synced_sha: fe395ea4608f
synced: 2026-05-31
related: [ai-pipeline.md, ../api/endpoints.md]
---

## Purpose

One abstraction (`AIProvider`) over Anthropic, OpenAI, and Gemini, with a factory that picks a provider, falls back through the others, and routes to a server proxy when the user has no key.

## Why it exists / responsibilities

The rest of the app should never branch on which LLM vendor is in use. This module hides that behind a single `call(options)` method and owns:

- **Three direct providers** (`AnthropicProvider`, `OpenAIProvider`, `GeminiProvider`) that hit each vendor's REST API from the browser using the user's own key.
- **A proxied provider** (`ProxiedProvider`) that posts to `/api/ai` with a Supabase JWT, for signed-in users who have no key of their own (server holds the keys).
- **Selection + fallback** — `createProvider()` prefers the user's chosen vendor, then any other configured key, then the proxy.
- **A "fast" tier** — every provider exposes `fast()` returning a cheaper model variant, surfaced as `createFastProvider()` / `createSmartProvider()`.
- **Cost tracking + a session budget guard** accumulated per browser session.

## Mental model

```
caller (ai-pipeline / AIPanel / Chat)
        │  createProvider() / createFastProvider()
        ▼
   AIProvider.call({ systemPrompt, messages, maxTokens, temperature })
        │
   ┌────┴───────────────┬───────────────┐
   user has key?       no key, signed in
   ▼                    ▼
 AnthropicProvider   ProxiedProvider ──► POST /api/ai (Bearer JWT)
 OpenAIProvider
 GeminiProvider ──► vendor REST API
        │
        ▼
   trackCost(...) ──► _sessionCosts (module-level accumulator)
```

`createProvider` is a synchronous lookup of `localStorage` keys; no network until `call()`.

## Key types & functions

- `AIProviderType = 'anthropic' | 'openai' | 'gemini'` — `src/lib/aiProvider.ts:11`
- `AIMessage` / `AICallOptions` / `AICallCost` — request and cost shapes — `src/lib/aiProvider.ts:13`, `:18`, `:25`
- `interface AIProvider` — `{ name, type, call(options) }` — `src/lib/aiProvider.ts:34`
- `class ProxiedProvider` — posts to `/api/ai` with Supabase JWT; throws "Sign in to use AI features." when no session token — `src/lib/aiProvider.ts:108`. Has `fast()` returning a proxied fast-model instance — `src/lib/aiProvider.ts:185`.
- `class AnthropicProvider` — direct `api.anthropic.com/v1/messages` call. Splits the system prompt into a cached static prefix block + dynamic suffix via `splitSystemPrompt()` (marker is the "Valid visual tokens" line) — `src/lib/aiProvider.ts:197`, split at `:264`, `fast()` at `:280`.
- `class OpenAIProvider` — direct `api.openai.com/v1/chat/completions` call; system prompt prepended as a `system` message — `src/lib/aiProvider.ts:292`, `fast()` at `:341`.
- `class GeminiProvider` — direct `generativelanguage.googleapis.com` call; maps `assistant` role → `model`, system prompt → `system_instruction` — `src/lib/aiProvider.ts:353`, `fast()` at `:404`.
- `getPreferredProvider()` / `setPreferredProvider()` — read/write `localStorage` key `satie-ai-provider`, default `'anthropic'` — `src/lib/aiProvider.ts:413`, `:417`.
- `createProvider(preferred?)` — selection + fallback (see Data flow) — `src/lib/aiProvider.ts:426`.
- `createFastProvider(preferred?)` — calls `createProvider()` then `.fast()` if present — `src/lib/aiProvider.ts:453`.
- `isComplexPrompt(prompt, hasExistingScript)` — heuristic: short edits / "make it…/add reverb…" patterns → simple; from-scratch or long/compositional prompts → complex — `src/lib/aiProvider.ts:470`.
- `createSmartProvider(prompt, hasExistingScript, preferred?)` — `isComplexPrompt` → main vs fast tier — `src/lib/aiProvider.ts:500`.
- `getAvailableProviders()` / `hasUserApiKey()` — which keys are in `localStorage` — `src/lib/aiProvider.ts:512`, `:526`.
- `getServerProviders()` — GETs `/api/ai`, caches `data.providers` for proxy users — `src/lib/aiProvider.ts:541`.
- Cost API: `trackCost()`, `getSessionCosts()`, `getSessionCostCents()`, `resetSessionCosts()` — `src/lib/aiProvider.ts:62`–`:80`.
- Budget API: `getSessionBudgetCents()`, `setSessionBudgetCents()`, `checkBudget()` — default $0.50 in `localStorage` key `satie-session-budget-cents` — `src/lib/aiProvider.ts:84`–`:104`.

## Data flow

**Callers in:** the [AI generation pipeline](./ai-pipeline.md) (`aiGenerate.ts`) is the primary consumer, which both `AIPanel.tsx` and `Chat.tsx` go through. They call `createProvider` / `createFastProvider` / `createSmartProvider`, then `provider.call(...)`.

**Calls out:**

- Direct providers → vendor HTTPS endpoints with the user's key.
- `ProxiedProvider` → `POST /api/ai` (and `getServerProviders` → `GET /api/ai`). See [API endpoints](../api/endpoints.md). It attaches `Authorization: Bearer <supabase access_token>` from `supabase.auth.getSession()`.

**Selection logic in `createProvider` (`:426`):** builds an `order` array `[anthropic, openai, gemini]` paired with their `localStorage` keys, sorts the preferred type to the front, then returns the first provider whose key is non-empty. If no user keys exist, returns `new ProxiedProvider(pref)`.

**Cost flow:** each provider parses vendor usage from its response (`cache_read_input_tokens` for Anthropic, `prompt_tokens_details.cached_tokens` for OpenAI, `cachedContentTokenCount` for Gemini), computes cents via `calculateCost`/`PRICING`, and pushes into the module-global `_sessionCosts`. `ProxiedProvider` instead trusts `data.cost_cents` from the proxy.

## Invariants & gotchas

- **No key → proxy → sign-in required.** `ProxiedProvider.call` throws if there is no Supabase session token. Unauthenticated, keyless users cannot generate.
- **Preferred is a soft preference, not a guarantee.** `createProvider` will silently fall back to *any* other configured key before reaching the proxy. The provider actually used may differ from `getPreferredProvider()`. The proxy itself may also re-route across vendors; that is logged to console when `data.provider !== this.type` (`:165`).
- **`PRICING` and model IDs are hardcoded** (`:43`). Adding/changing a model means updating `PRICING`, the `*_MODELS` constants, and `defaultModel()`/`fastModel()` in `ProxiedProvider`, or `calculateCost` returns 0 for the unknown model.
- **Anthropic prompt-cache split is marker-based.** `splitSystemPrompt` keys off the exact "Valid visual tokens…" string (`:267`). If `buildSystemPrompt` in [ai-pipeline](./ai-pipeline.md) changes that line, the cache prefix silently stops splitting (falls back to one un-cached block) — caching cost savings vanish without an error.
- **Session cost/budget state is module-global and per-tab** — it resets on reload and is not shared across tabs. `checkBudget` only *reports* `over`; callers decide enforcement.
- **`getServerProviders` caches forever** for the session (`_serverProviders`); a server config change won't be seen until reload.
- **Gemini fast tier is `gemini-2.0-flash-lite`**, priced at 0 in `PRICING` — its tracked cost will always be 0.

## Change checklist

When editing this file:

- Adding a provider: implement the `AIProvider` class, add it to the `order` array in `createProvider` (`:433`), add its key to `getAvailableProviders`/`hasUserApiKey`, add a `PRICING` entry and `*_MODELS` block, and follow the broader steps in `CLAUDE.md` → "Adding a new AI provider" (userSettings, Dashboard, AIPanel select).
- Changing a model ID: update `PRICING`, the `*_MODELS` const, and `ProxiedProvider.defaultModel()`/`fastModel()` together.
- Touching the Anthropic system-prompt split marker: keep it in lockstep with `buildSystemPrompt` in [ai-pipeline](./ai-pipeline.md).
- Changing the `/api/ai` request/response shape: update both `ProxiedProvider.call` and the [API endpoint](../api/endpoints.md).

## Sources

- `src/lib/aiProvider.ts`
