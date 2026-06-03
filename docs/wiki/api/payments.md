---
title: Payments — Stripe functions
subsystem: api
sources:
  - api/stripe/**
synced_sha: 80c7af875307
synced: 2026-05-31
related: [../lib/auth.md]
---

# Payments — Stripe functions

## Purpose
Four Vercel serverless functions that sell, grant, report, and fulfill prepaid AI/audio generation credits backed by a Supabase `credits` table.

## Why it exists / responsibilities
Satie's AI and audio generation cost real money. Users prepay into a credit balance (denominated in cents) that the generation endpoints draw down. These functions own:
- **checkout** — turn a chosen dollar amount into a Stripe Checkout session.
- **claim-free-credits** — give each new user a one-time $1.00 grant.
- **status** — report the signed-in user's balance.
- **webhook** — receive Stripe's `checkout.session.completed` and credit the balance after payment clears.

The money model: the user pays the dollar amount they pick; Satie keeps a 10% cut (`SATIE_CUT`), and the remaining 90% becomes the credit balance. One credit cent = one cent of API budget.

## Mental model
Two write paths add credits, both `upsert`ing the same `credits` row keyed by `user_id`:

```
                  user picks $20
client ──POST──▶ checkout ──────▶ Stripe Checkout (hosted page)
                  (creates session,                  │ user pays
                   does NOT add credits)             ▼
                                     Stripe ──POST──▶ webhook ──upsert──▶ credits.balance_cents += credits_cents
new sign-in  ──POST──▶ claim-free-credits ──upsert──▶ credits.balance_cents += 100  (once)
any time     ──GET───▶ status ──select──▶ credits.balance_cents
```

Credits are only ever granted by **webhook** (after real payment) or **claim-free-credits** (one-time gift). `checkout` itself never touches the balance — it just creates the Stripe session and stashes the credit amount in `session.metadata.credits_cents` for the webhook to read back.

## Key types & functions
All four are default-export Vercel handlers `(req: VercelRequest, res: VercelResponse)`.

- **checkout** `api/stripe/checkout.ts:29` — POST, requires `Bearer` auth via `getUser` (`api/stripe/checkout.ts:20`). Body `{ amount }` must be in `VALID_AMOUNTS = [5,10,20,50]` (`api/stripe/checkout.ts:18`). Computes `chargeCents = amount*100` and `creditsCents = round(chargeCents * (1 - SATIE_CUT))` (`api/stripe/checkout.ts:44`), creates a one-time `mode: 'payment'` session, sets `client_reference_id = user.id` plus `metadata.supabase_user_id` / `metadata.credits_cents` (`api/stripe/checkout.ts:65`), and returns `{ url }`.
- **claim-free-credits** `api/stripe/claim-free-credits.ts:13` — POST, `Bearer` auth inline. Reads the user's `credits` row; if `free_credits_claimed` is already true returns `{ claimed: false, balance_cents }` (`api/stripe/claim-free-credits.ts:41`). Otherwise upserts `balance += FREE_CREDITS_CENTS (100)` with `free_credits_claimed: true` (`api/stripe/claim-free-credits.ts:49`) and returns `{ claimed: true, balance_cents }`.
- **status** `api/stripe/status.ts:11` — GET. Soft-auth: no/invalid token returns `{ balance_cents: 0 }` with HTTP 200 rather than 401 (`api/stripe/status.ts:18`, `:24`). On success selects `balance_cents` for the user (`api/stripe/status.ts:28`).
- **webhook** `api/stripe/webhook.ts:29` — POST, **no Supabase auth** — authenticated by Stripe signature instead. Exports `config = { api: { bodyParser: false } }` (`api/stripe/webhook.ts:19`) so the raw body survives; `buffer()` (`api/stripe/webhook.ts:21`) reassembles it for `stripe.webhooks.constructEvent(body, sig, WEBHOOK_SECRET)` (`api/stripe/webhook.ts:38`). On `checkout.session.completed` it reads `client_reference_id || metadata.supabase_user_id` and `metadata.credits_cents`, then upserts `balance += creditsCents` (`api/stripe/webhook.ts:66`).

Shared config across files: `Stripe` client pinned to `apiVersion: '2026-03-25.dahlia'`; Supabase client built with `SUPABASE_SERVICE_ROLE_KEY` (service role, bypasses RLS); secrets from env `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `VITE_SUPABASE_URL`/`SUPABASE_URL`.

## Data flow
- **Callers in (client):** `src/ui/components/Header.tsx` invokes `checkout` (then redirects to `session.url`) and `status` to show the balance; `src/lib/AuthContext.tsx` calls `claim-free-credits` on sign-in. See [auth](../lib/auth.md) for how the `Bearer` token (Supabase access token) is obtained.
- **Caller in (Stripe):** the Stripe Dashboard webhook (event `checkout.session.completed`) POSTs to `webhook`.
- **Calls out:** all four write/read the Supabase `credits` table (`user_id`, `balance_cents`, `free_credits_claimed`, `updated_at`) via the service-role client. `checkout` and `webhook` call the Stripe API. Generation endpoints (`api/ai.ts`, `api/generate-audio.ts`) are the downstream consumers that draw the balance back down.

## Invariants & gotchas
- **checkout never grants credits.** Reaching `success_url` (`/?credits_added=N`) is *not* proof of payment — only the **webhook** mutates the balance. If the webhook is misconfigured, paid users get nothing.
- **Webhook auth ≠ user auth.** The webhook is unauthenticated at the Supabase level; its trust comes entirely from `constructEvent` signature verification against `STRIPE_WEBHOOK_SECRET`. If `sig` or the secret is missing it 400s before doing anything (`api/stripe/webhook.ts:33`).
- **Raw body required.** `bodyParser: false` + manual `buffer()` is mandatory — any body parsing/mutation breaks the signature check.
- **Failed-fulfillment events return 200.** Missing `userId`/`creditsCents` logs and returns `{ received: true }` 200 (`api/stripe/webhook.ts:49`) so Stripe does not retry a structurally bad event.
- **No replay idempotency on the webhook.** Crediting is read-balance-then-upsert-new-balance, not an atomic increment, and there is no dedup on Stripe `event.id`. A redelivered `checkout.session.completed` (Stripe retries until 200) would double-credit, and concurrent writers can race on `balance_cents`. `claim-free-credits` *is* idempotent (guarded by `free_credits_claimed`).
- **`status` lies on auth failure.** It returns `balance_cents: 0` (not 401) for missing/invalid tokens, so a transient auth glitch shows the user a zero balance rather than an error.
- **Amounts are server-validated.** The client cannot pick an arbitrary charge — only `[5,10,20,50]` pass (`api/stripe/checkout.ts:40`); `unit_amount` is derived server-side, never trusted from the body.

## Change checklist
- New purchase tier → edit `VALID_AMOUNTS` (`api/stripe/checkout.ts:18`); update the Header purchase UI.
- Change the cut/credit math → keep `creditsCents` in `checkout` and the `metadata.credits_cents` the webhook reads (`api/stripe/webhook.ts:47`) in lockstep.
- New `credits` columns → update the `select`/`upsert` shapes in all four files and the migration.
- New Stripe event type → branch in `webhook` (`api/stripe/webhook.ts:44`) and subscribe to it in the Stripe Dashboard.
- Adding replay protection → persist `event.id` and short-circuit duplicates before the upsert; prefer an atomic SQL increment over read-then-write.
- New env var (Stripe/Supabase) → add to Vercel project env for every deploy target.

## Sources
- `api/stripe/checkout.ts`
- `api/stripe/claim-free-credits.ts`
- `api/stripe/status.ts`
- `api/stripe/webhook.ts`
