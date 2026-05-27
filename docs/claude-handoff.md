# Satie — Engineering Handoff (living doc)

Latest session on top. This is the "where we are / what's next" doc the next session
should read first. Durable cross-session lessons live in `docs/lessons.md`.

---

# Latest — Routing reliability & first-load performance (2026-05-26)

User reported: on first open of satie.live, clicking a nav tab changed the URL but
the page didn't render ("link appears to change, nothing happens"); after the first
fix, nav committed but the **first navigation was slow**.

## What was wrong

1. **Nav freeze.** `react-router-dom@7` wraps navigations in `React.startTransition`
   by default. Navigating to a `lazy()` route keeps the *old* screen mounted until
   the new chunk loads, so the URL updated (`pushState`) but content + active-tab
   state lagged. With `Suspense fallback={null}` and **no route-level error
   boundary**, a slow/failed chunk (e.g. stale hashes after a redeploy) looked like a
   permanent freeze. (Screenshot tell: URL `/library` but "create" still highlighted.)
2. **Heavy eager bundle.** `dist/index.html` eagerly `modulepreload`-ed ~1.6 MB
   (`vendor-three` 1.1 MB included). Root cause was subtle: the old `manualChunks`
   **object form** let Rollup co-locate Vite's shared `__vitePreload` helper into the
   `vendor-three` chunk, so the entry statically imported all of Three just to get
   that helper → eager preload. (See lessons.md #2.)
3. **Slow first nav (after fix #2).** Moving Three off the initial path meant the
   first visit to a 3D-using page paid the 861 KB download. Worst offender: `Library`
   **statically** imported `SampleGraph` (the 3D knowledge graph) even though the
   default `grid` view never renders it. The idle-preload also only started *after*
   the splash — exactly when the user first clicks.

## What shipped

| Fix | Files |
|-----|-------|
| `lazyWithRetry` / `lazyRoute` — retry once, then one-time stale-chunk reload (sessionStorage-guarded) | `src/lib/lazyWithRetry.ts` (new) |
| Route-level `ErrorBoundary` (reload fallback) + real `Suspense` spinner; `Editor` now lazy | `src/main.tsx`, `src/ui/components/RouteFallback.tsx` (new) |
| Route chunk preloading — on link hover/focus + during the splash | `src/lib/routePreload.ts` (new), `src/ui/components/Header.tsx`, `src/main.tsx` |
| Lazy-load `SpatialViewport` in Chat (Three off the landing path), degrade to audio-only on chunk failure | `src/ui/pages/Chat.tsx` |
| Lazy-load `SampleGraph` in Library — `/library` renders from a 14 KB chunk; Three loads only on graph view | `src/ui/pages/Library.tsx` |
| Drop the buggy three/monaco manual chunks; keep only a cacheable `vendor-react` chunk | `vite.config.ts` |
| RiverCanvas perf — cap DPR to 1.5, precomputed dark-mode glow sprites, throttle ~30 fps, pause when tab hidden | `src/ui/components/RiverCanvas.tsx` |

**Result:** eager critical path ~1.6 MB → **617 KB** (`index` 394 KB + cacheable
`vendor-react` 223 KB). Three.js (861 KB) is on-demand. `npm run build` clean,
`npm run test` 258/258.

**Verified live (production build via `npm run preview` + Playwright):** clicking
`library`/`explore` updates URL + content + active tab (freeze gone); navigating to
`/library` fetches only the 14 KB Library chunk (Three.js **not** fetched); switching
to graph view lazily loads Three on demand and the canvas renders; zero console errors.

## Git state (read before pushing)

- `8a010a1` — "Fix nav freeze + cut first-load weight" — **pushed to origin/main**.
- `8805c03` — "Make first navigation fast: code-split Library's 3D graph, preload
  during splash" — **committed locally, NOT pushed** (user is pushing it themselves).
- Pushing to `main` deploys to production (satie.live) via Vercel. The auto-mode
  classifier gates repeat prod pushes — get explicit per-deploy authorization.

## Still on the table (first-load / perf)

- **Monaco loads from a CDN.** `@monaco-editor/react` → `@monaco-editor/loader` fetches
  Monaco core from jsDelivr at runtime (the in-build `ts.worker-*.js` is ~7 MB but the
  core itself is CDN-fetched). This is a **reliability risk** for `/editor` and the
  inline `ChatMessage` script editor (breaks if the CDN is unreachable / offline /
  blocked). Consider self-hosting Monaco via `loader.config({ paths: { vs: '/...' } })`
  or bundling it. Strip unused TS/HTML/CSS/JSON workers — Satie uses a custom Monarch
  tokenizer and registers no built-in language, so those workers should never fire.
- **Vercel region.** Supabase is US. If Vercel primary region is us-east-1 and most
  users are LATAM, consider a closer region — but confirm user distribution first.

---

# Prior — Cross-region Latency Pass (2026-05-11)

Diagnosed/fixed tab-load latency reported from Peru against a US-region Supabase. User
confirmed "improved a lot."

## What was wrong and what shipped

The original "10s tab navigation" was **not** a Supabase round-trip problem. The
biggest culprit was a 33 MB `Satie-Theme.wav` fetched on every page using
`useBackgroundMusic`, saturating Peru→US bandwidth. Several list queries also pulled
full script bodies they didn't need.

| Fix | Files |
|-----|-------|
| **Background music: deferred fetch + 33 MB → 2.8 MB MP3** | `src/ui/hooks/useBackgroundMusic.ts`, `public/Satie-Theme.mp3` (WAV deleted), 4 page callers |
| **`script_preview` generated column** — `substring(script, 1, 200) STORED` | `supabase/migrations/009_script_preview.sql` (applied via `npx supabase db query --linked`) |
| **`SketchListItem` type** + list-query variants that omit `script` | `src/lib/supabase.ts`, `src/lib/sketches.ts` |
| **Batched profile fetch** — single `.in('id', ids)` | `src/lib/profiles.ts` (`getProfilesByIds`), `src/ui/pages/Chat.tsx` |
| **Drop 1536-dim embedding from community sample list queries** | `src/lib/communitySamples.ts` (`COMMUNITY_LIST_COLS`, `getPopularSampleNames`) |
| **SessionStorage cache for list queries** with TTL + invalidation | `src/lib/queryCache.ts`; sketches.ts invalidates on create/update/delete/fork |
| **Editor: parallelize script + samples load** | `src/ui/pages/Editor.tsx` |
| **Non-blocking auth bootstrap** | `src/lib/AuthContext.tsx` (`hasStoredSession()`) |
| **Cache-Control: immutable** for `/assets/*` + audio | `vercel.json` |

> **Bundle-splitting item from this pass is now DONE (2026-05-26):** Three.js is no
> longer in the eager bundle (was 325 KB gzip preloaded) — it's an on-demand chunk.
> See the latest session above.

### How to verify if user reports slowness again

Don't speculate. Ask user to: open DevTools → Network in Brave on production, hard
refresh (Cmd+Shift+R), navigate between two tabs, screenshot the network panel. Look
for any request >500 KB or >2s, or an obvious waterfall.

`sessionStorage` cache keys: `sketches:user:<id>` (30s), `sketches:public` (60s),
`sketches:user-public:<id>` (30s), `community:popular:<limit>` (5 min),
`community:popular-names:<limit>` (10 min). Invalidation is automatic inside
`createSketch`/`updateSketch`/`deleteSketch`/`forkSketch`.

### False alarms — don't re-investigate

- **AuthContext `getSession()` blocking** — fixed; only blocks when a stored token exists.
- **Sequential SketchView loads** (`SketchView.tsx`) — exists but small impact vs the WAV.
- **Splash screen blocking each route** — only fires once per session via component state.
- **Supabase RLS full-table scans** — checked migration 008 (FK indexes); not the issue.

### Prior frontend audit fixes (2026-04-22) — still valid, don't regress

- Chat save-as-sketch awaits sample upload before navigating (`Chat.tsx`).
- ExportPanel AudioContext closed on teardown (`ExportPanel.tsx`).
- SketchView fork try/finally guards double-fork (`SketchView.tsx`).
- Chat scroll-to-bottom uses `useLayoutEffect`.
- `SatieEditor.tsx` module-level `languageRegistered` flag prevents duplicate Monaco registration.
- StrictMode double-AudioContext guarded by `engine.destroy()` before re-init.

### Known-suspect, low-priority

- `useSFX.ts` module-level shared AudioContext never closed (deliberate singleton).
- Fork doesn't copy samples — references original author's storage path.
- Editor autosave timer cleanup on unmount — theoretical `setState`-after-unmount.

---

## Environment snapshot

- Branch: `main`. Git user: Mateo Larrea. Do not commit/push unless asked; prod pushes need per-deploy OK.
- Build: `npm run build` clean. Tests: `npm run test` 258/258.
- Chunking (post-2026-05-26): no manual vendor-three/monaco; only a `vendor-react`
  manual chunk. Three.js/Monaco auto-split as on-demand chunks. See `vite.config.ts`.
- Supabase migrations live: 001–009. `supabase` CLI not on PATH — use `npx supabase@latest db query --linked` (network blocks direct Postgres). ffmpeg at `/opt/homebrew/bin/ffmpeg`.
- Dev: `npm run dev` (port 5173+). Prod build preview: `npm run preview` (port 4173).

## Tone reminder

Terse, no emojis, fix root causes, don't add cleanup/abstractions beyond the task.
Group script statements are unindented — don't reformat existing `.satie` scripts.
