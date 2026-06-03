---
title: Auth & user settings
subsystem: lib
sources:
  - src/lib/AuthContext.tsx
  - src/lib/userSettings.ts
synced_sha: a2a2a7be5e38
synced: 2026-05-31
related: [database.md, ../api/endpoints.md]
---

## Purpose

OAuth sign-in (GitHub/Google) via Supabase plus per-user API key storage that lives in both localStorage and Supabase.

## Why it exists / responsibilities

- Wraps Supabase Auth in a React context (`AuthProvider` / `useAuth`) so any component can read `user`/`session` and trigger sign-in/sign-out.
- Avoids a loading-screen flash for unauthenticated visitors: the app only blocks on session restore when a token is actually present in localStorage.
- Persists user-entered AI/ElevenLabs API keys. Keys are never hardcoded; they live in localStorage (guest fallback + cache) and, for logged-in users, in the Supabase `user_settings` table.
- Fires idempotent free-credit claiming on auth state changes.

## Mental model

Auth is a thin reactive mirror of Supabase's session. Settings are dual-written: localStorage is always authoritative for guests and acts as a cache for logged-in users; Supabase is the source of truth when a `userId` is present.

```
localStorage  <--cache/fallback-->  Supabase user_settings
     ^                                     ^
     | always written                      | only when userId != null
     +------------ saveKey / saveSettings --+
```

## Key types & functions

**AuthContext.tsx**
- `AuthState` interface — `{ user, session, loading, signInWithGitHub, signInWithGoogle, signOut }` (src/lib/AuthContext.tsx:5).
- `hasStoredSession()` — synchronously scans localStorage for any `sb-*-auth-token` key; used as the initial `loading` value so guests skip the splash (src/lib/AuthContext.tsx:45).
- `AuthProvider({ children })` — holds `user`/`session`/`loading` state, restores session via `supabase.auth.getSession()`, subscribes to `onAuthStateChange`, defines the OAuth/sign-out actions (src/lib/AuthContext.tsx:60).
- `signInWithGitHub` / `signInWithGoogle` — call `supabase.auth.signInWithOAuth` with `redirectTo: window.location.origin` (src/lib/AuthContext.tsx:90, src/lib/AuthContext.tsx:97).
- `signOut` — `supabase.auth.signOut()` (src/lib/AuthContext.tsx:104).
- `useAuth()` — context consumer; throws if used outside `AuthProvider` (src/lib/AuthContext.tsx:115).
- `claimFreeCredits(accessToken)` — fire-and-forget POST to `/api/stripe/claim-free-credits`, swallows errors if the endpoint isn't deployed (src/lib/AuthContext.tsx:17).
- `isLocalDev` / `devUser` / `devSession` — a hardcoded dev bypass, currently disabled (`isLocalDev = false`) to exercise real auth on localhost (src/lib/AuthContext.tsx:26).

**userSettings.ts**
- `UserSettings` interface — `{ anthropic_key, elevenlabs_key, openai_key, gemini_key }` (src/lib/userSettings.ts:7).
- `loadSettings(userId)` — reads localStorage; if `userId` is set, fetches from Supabase `user_settings`, caches the result back to localStorage, and migrates local keys up if no remote row exists (src/lib/userSettings.ts:35).
- `saveKey(userId, field, value)` — writes one key to localStorage always, then upserts to Supabase when logged in (src/lib/userSettings.ts:86).
- `saveSettings(userId, settings)` — writes all four keys to localStorage then upserts the full row to Supabase (src/lib/userSettings.ts:110).
- `getPreferCommunitySamples()` / `setPreferCommunitySamples(value)` — localStorage-only boolean for community-first sample mode (src/lib/userSettings.ts:21, src/lib/userSettings.ts:26).

localStorage key constants: `satie-anthropic-key`, `satie-elevenlabs-key`, `satie-openai-key`, `satie-gemini-key`, `satie-prefer-community-samples` (src/lib/userSettings.ts:14).

## Data flow

- `main.tsx` mounts `AuthProvider` near the root so the whole app reads `useAuth()`.
- Pages/components call `useAuth()` for gating (e.g. [Chat](../ui/pages.md) requires auth, Sidebar shows sign-in). They get `user.id` and pass it as `userId` into the settings functions.
- The Dashboard settings panel calls `loadSettings` / `saveKey` to populate and persist API-key inputs.
- AI code paths read keys out of localStorage (see [aiProvider](./ai-providers.md)) — `loadSettings`/`saveKey` keep that localStorage cache current.
- Auth talks only to `supabase` from [supabase.ts](./database.md); settings read/write the `user_settings` table — see [database](./database.md).
- `claimFreeCredits` calls the `/api/stripe/claim-free-credits` endpoint — see [endpoints](../api/endpoints.md).

## Invariants & gotchas

- `loading` starts `true` only when `hasStoredSession()` is true. Don't replace it with an unconditional `true` or guests get a needless splash; don't drop the localStorage peek or you reintroduce a network RTT before first render.
- `onAuthStateChange` does not flip `loading`; only the initial `getSession()` resolution does (src/lib/AuthContext.tsx:73).
- Supabase settings fetches that error are remembered in `_supabaseSettingsFailedAt`; subsequent `loadSettings` calls short-circuit to localStorage for `SUPABASE_RETRY_COOLDOWN_MS` (30s) to avoid retrying on every navigation (src/lib/userSettings.ts:31, src/lib/userSettings.ts:44).
- All Supabase writes are wrapped in try/catch and silently fall back to localStorage; a "save" succeeding locally does not guarantee remote persistence.
- `saveKey`'s localStorage key mapping is a manual ternary chain — adding a new `UserSettings` field requires extending it (src/lib/userSettings.ts:92).
- API keys are user-supplied and must never be hardcoded or committed (see CLAUDE.md External Services).
- `isLocalDev` is a real dev backdoor; flipping it to `true` injects `devUser`/`devSession` and bypasses Supabase entirely.

## Change checklist

- Adding a new API-key field: extend `UserSettings`, add an `LS_*` constant, update `loadSettings` select + cache writes, `saveSettings` upsert, the `saveKey` ternary, the Supabase `user_settings` table/columns ([database](./database.md)), and the Dashboard settings inputs.
- Adding an OAuth provider: add a `signInWith*` action + the field to `AuthState`, and surface it in the sign-in UI.
- Changing session-restore timing: re-check the `loading`/`hasStoredSession` interplay so guests still render immediately.
- Touching the credit-claim flow: keep it idempotent and fire-and-forget; coordinate with the `/api/stripe/claim-free-credits` endpoint ([endpoints](../api/endpoints.md)).

## Sources

- src/lib/AuthContext.tsx
- src/lib/userSettings.ts
