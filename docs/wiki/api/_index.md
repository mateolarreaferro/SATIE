---
title: API — Vercel Functions overview
subsystem: api
sources: []
synced_sha: pending
synced: 2026-05-30
related: [endpoints.md, payments.md]
---

# API — Vercel Functions overview

## Purpose

The `api/` directory holds Satie's serverless backend: Vercel Functions that proxy paid third-party APIs (AI providers, ElevenLabs, Stripe) behind server-side secrets and a per-user credit ledger.

## Why it exists / responsibilities

Satie is a browser app, but several features cost real money per call: LLM script/sample generation, ElevenLabs audio synthesis, and Stripe payments. The provider secrets that authorize those calls (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `ELEVENLABS_API_KEY`, `STRIPE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) must never reach the client — anyone could read them from the bundle or network tab and drain the account.

So the `api/` layer exists to:

- **Hold the secrets.** Keys live only in Vercel environment variables, read via `process.env` inside the function. The client only ever sends a Supabase JWT.
- **Gate every paid call on auth + credits.** Each function authenticates the caller's Supabase JWT to a `user_id`, checks the `credits` table balance, makes the upstream call, then deducts the measured cost. No credits → `402`; no JWT → `401`.
- **Own billing.** Stripe Checkout, the Stripe webhook that grants credits, balance readout, and the one-time free-credit grant.

Note: this is distinct from the *client-side* user-key flow described in `CLAUDE.md` (users pasting their own keys into localStorage). The `api/` layer is the managed-credits path where Satie holds the keys and meters usage.

## Mental model

Think of `api/` as a thin, authenticated **paywall in front of upstream paid APIs**, with Supabase as both the identity provider and the credit ledger.

```
browser ──Bearer <supabase JWT>──▶  /api/* function
                                        │ 1. authenticateUser(JWT) → user_id   (Supabase service role)
                                        │ 2. checkCredits(user_id)             (credits.balance_cents > 0?)
                                        │ 3. fetch upstream w/ SERVER secret    (Anthropic / OpenAI / Gemini / ElevenLabs)
                                        │ 4. deductCredits(user_id, costCents)
                                        ▼
                                     response (text / audio bytes / checkout url)

Stripe ──signed webhook──▶ /api/stripe/webhook ──▶ credits.balance_cents += creditsCents
```

Every function is a standalone Vercel Function (`export default async function handler(req, res)`) with no shared module state; the `authenticateUser` / `checkCredits` / `deductCredits` helpers are copy-pasted per file rather than imported.

## Key types & functions

The functions, grouped — full detail lives in [endpoints](./endpoints.md) and [payments](./payments.md):

**AI + audio proxies** (see [endpoints](./endpoints.md))

- AI proxy with provider fallback — `api/ai.ts:185`. `POST` routes a chat completion to the preferred provider, falling back through every configured provider on failure; `GET` returns `AVAILABLE_PROVIDERS`. Cost computed from token usage at `api/ai.ts:46`.
- ElevenLabs audio proxy — `api/generate-audio.ts:71`. `POST { prompt, duration?, influence? }` → `audio/mpeg` bytes; flat 1-cent charge per generation (`api/generate-audio.ts:24`).

**Payments + credits** (see [payments](./payments.md))

- Stripe Checkout session — `api/stripe/checkout.ts:29`. Creates a payment session; user pays the chosen dollar amount, 90% becomes credits (`SATIE_CUT = 0.10`, `api/stripe/checkout.ts:17`).
- Stripe webhook — `api/stripe/webhook.ts:29`. Verifies the signature and adds `credits_cents` on `checkout.session.completed`. Disables Vercel's body parser (`api/stripe/webhook.ts:19`) so the raw body can be signature-checked.
- Credit balance readout — `api/stripe/status.ts:11`. `GET` → `{ balance_cents }` for the JWT holder (returns `0` for anonymous instead of erroring).
- One-time free-credit grant — `api/stripe/claim-free-credits.ts:13`. Idempotent `$1.00` grant gated on the `free_credits_claimed` flag.

**Shared per-file helpers** (same shape in `ai.ts`, `generate-audio.ts`, `checkout.ts`, `status.ts`, `claim-free-credits.ts`)

- `authenticateUser(req)` / `getUser(req)` — `api/ai.ts:146`, `api/stripe/checkout.ts:20`. Pulls the `Bearer` token, calls `supabase.auth.getUser()` with the service-role client, returns the `user_id` (or `null`).
- `checkCredits(userId)` — `api/ai.ts:155`. Returns an error string if `balance_cents <= 0`, else `null`.
- `deductCredits(userId, costCents)` — `api/ai.ts:168`. Read-modify-write upsert of `balance_cents` floored at `0`.

## Data flow

- **Callers in:** the React client. AI calls originate in `src/lib/aiProvider.ts` / `src/lib/aiGenerate.ts` (consumed by [AIPanel](../ui/ai-panel.md) and [Chat](../ui/pages.md)); audio generation in `src/engine/audio/AudioGen.ts`; billing UI in the Dashboard. Every request carries the Supabase JWT from `src/lib/AuthContext.tsx`.
- **Calls out:** Anthropic (`api.anthropic.com`), OpenAI (`api.openai.com`), Gemini (`generativelanguage.googleapis.com`), ElevenLabs (`api.elevenlabs.io`), Stripe SDK, and Supabase via the **service-role** client (which bypasses RLS — see gotchas).
- **State store:** the Supabase `credits` table (`user_id`, `balance_cents`, `free_credits_claimed`, `updated_at`) is the single source of truth for billing, read and written by all functions.

## Invariants & gotchas

- **Secrets are server-only.** Anything in `process.env` inside `api/*` (provider keys, `STRIPE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) must never be imported into `src/**` or prefixed `VITE_` — Vite inlines `VITE_*` into the client bundle. Only `VITE_SUPABASE_URL` / anon-key belong on the client.
- **Service-role client bypasses RLS.** These functions use `SUPABASE_SERVICE_ROLE_KEY`, so Supabase Row-Level Security does *not* protect the `credits` table here. Auth/ownership must be enforced in code (always scope queries by the JWT-derived `user_id`).
- **The webhook needs the raw body.** `api/stripe/webhook.ts:19` sets `config.api.bodyParser = false` and reassembles the body manually so `stripe.webhooks.constructEvent` can verify the signature. Re-enabling the body parser silently breaks signature verification.
- **Credit deduction is not atomic.** `deductCredits` is a read-then-write upsert with no transaction or row lock; concurrent calls can race and over-spend. Deductions are also fire-and-forget (`.catch(() => {})`), so a deduct failure does not fail the user's request.
- **Cost is best-effort, floored at 1 cent.** `calculateCostCents` returns `1` for unknown models and `Math.max(1, …)` otherwise; audio is a flat 1 cent regardless of duration.
- **`status.ts` never 401s.** It returns `{ balance_cents: 0 }` for missing/invalid tokens so the UI can render a balance for signed-out users without error handling.
- **Free credits are flag-gated, not row-gated.** Re-claiming is blocked by `free_credits_claimed`, not by the row's existence — a row may pre-exist (e.g. from a deduct) and still be eligible.
- **Provider fallback can partially succeed.** `api/ai.ts` returns the first provider that yields non-empty text and reports it as `provider`; earlier failures surface in `warnings`.

## Change checklist

When changing this layer:

- **New endpoint:** add `api/<name>.ts` exporting `default handler(req, res)`; replicate the CORS preamble, `authenticateUser` + `checkCredits` + `deductCredits` pattern; document it in [endpoints](./endpoints.md) or [payments](./payments.md) and add it to this page's prose.
- **New AI provider:** add its key to `KEYS` and a model to `DEFAULT_MODELS`/`PRICING` in `api/ai.ts`, plus the `callProvider` and `extractText` cases. Mirror client changes per `CLAUDE.md` "Adding a new AI provider".
- **New secret:** add it to Vercel env vars (never `VITE_`-prefixed), read via `process.env`. Never commit it.
- **Pricing/credit changes:** update `PRICING` (`api/ai.ts:31`), `SATIE_CUT` (`api/stripe/checkout.ts:17`), `FREE_CREDITS_CENTS` (`api/stripe/claim-free-credits.ts:11`), or the audio flat rate (`api/generate-audio.ts:22`) together so the paywall and Checkout stay consistent.
- **Wiki gate:** any edit under `api/**` requires updating the covering wiki page in the same commit (`.claude/rules/wiki.md`); run `npm run wiki:gate`.

## Sources

This is an overview/hub page (`sources: []`). The functions are documented canonically by:

- [endpoints.md](./endpoints.md) — `api/ai.ts`, `api/generate-audio.ts`
- [payments.md](./payments.md) — `api/stripe/checkout.ts`, `api/stripe/webhook.ts`, `api/stripe/status.ts`, `api/stripe/claim-free-credits.ts`
