# Satie — Engineering Lessons (accumulating)

Durable, reusable lessons learned while building Satie — the non-obvious gotchas worth
remembering across sessions. Newest section on top. Keep each entry: **symptom →
cause → takeaway**. For "where we are right now," see `docs/claude-handoff.md`.

---

## Theming / dark mode (2026-05-26)

### 8. Hardcoded hex colors break dark mode — use theme tokens
**Symptom:** in dark mode, DocsPanel code blocks rendered as bright cream boxes, the
AI panel input was cream, and several labels/placeholders were invisible (dark-on-dark).
**Cause:** components hardcoded the light palette (`#faf9f6`, `#f0efe8`, `#d0cdc4`,
`#1a3a2a`, `#1a1a1a`, …) instead of reading `useTheme()` tokens, so they didn't adapt.
**Takeaway:** always paint from theme tokens (`theme.bg/text/textMuted/border/cardBg/
accent/accentText/danger/overlayText`). Two traps that hide hardcoded colors:
- **Module-level `CSSProperties` style objects can't see `theme`.** Convert them to
  functions that take `theme` (e.g. `contentStyle(theme)`), or define them inside the
  component. (DocsPanel's `navStyle`/`navBtnStyle`/`contentStyle` were the culprits.)
- **An element with only `opacity` and no `color` inherits a non-theme color** and
  vanishes on the opposite background. Always set an explicit themed `color` — use
  `theme.textMuted` for subtle placeholder/status text instead of `opacity: 0.2` on an
  inherited color.
**Check:** `grep -nE "#faf9f6|#f4f3ee|#f0efe8|#d0cdc4|#e8e0d8|'#1a1a1a'|'#1a3a2a'"
src/ui/components/*.tsx` to find regressions; verify both modes via screenshot.

---

## Routing & bundling (2026-05-26)

### 1. React Router v7 navigations are React transitions
**Symptom:** click a nav link → URL bar changes but the page doesn't render; the
active-tab/`useLocation()` state stays on the old route (e.g. URL `/library`, "create"
still highlighted). Looks like a hard freeze.
**Cause:** `react-router-dom@7` wraps navigations in `React.startTransition` by
default. Navigating to a `lazy()` route that suspends keeps the **old UI mounted**
until the new chunk resolves; with `Suspense fallback={null}` there's no feedback, and
with no route-level error boundary a *failed* chunk import (stale hashes after a
redeploy) never resolves → permanent freeze.
**Takeaway:** for code-split routes always pair: (a) a route-level `ErrorBoundary` that
recovers from chunk-load failures (retry → one-time `location.reload()`, guarded
against loops), (b) a real `Suspense` fallback, and (c) **preload** the likely-next
chunks (on link hover/focus + during idle/splash) so the transition commits instantly.
See `src/lib/lazyWithRetry.ts`, `src/lib/routePreload.ts`.

### 2. Vite `manualChunks` object form silently drags a vendor chunk into the eager entry
**Symptom:** `dist/index.html` `modulepreload`-s a huge vendor chunk (e.g. `vendor-three`
1.1 MB) on the landing page even though nothing on that page uses it. Lazy-loading the
components that use it does **not** remove the preload.
**Cause:** with `manualChunks: { 'vendor-three': [...] }`, Rollup co-locates Vite's
shared `__vitePreload` helper into that named chunk. Every dynamic `import()` (incl. the
entry's lazy routes) uses that helper, so the entry **statically** imports the whole
vendor chunk just to get it → eager preload.
**Diagnose:** check `dist/index.html` for `modulepreload` links, then look at the entry
chunk's *leading* `import ... from "./vendor-X.js"` statements. If the entry imports only
1–3 tiny aliased symbols (e.g. `import{_ as re}from"./vendor-three…"`) and `re` is used
as `re(()=>import(...))`, that's the preload helper leaking.
**Takeaway:** prefer minimal/function-form `manualChunks` — only manually chunk what is
*legitimately* eager (React). Let Rollup auto-split heavy on-demand libs (Three, Monaco);
they become shared chunks imported only by the routes that need them. See `vite.config.ts`.

### 3. Code-splitting moves cost from first paint to first navigation
**Symptom:** initial load got fast, but the **first** click to a route that uses a heavy
lib (Three) became slow — it downloads the big chunk then.
**Takeaway:** two complementary fixes — (a) **preload during dead time**: warm the
top-nav chunks during the splash (network is idle, user can't click yet) so they're
cached before first interaction; (b) **keep route chunks light**: lazy-load heavy
*secondary* views so the route's own chunk stays small (see #4).

### 4. A static import of a conditionally-rendered component still bundles its full dep tree
**Symptom:** `/library` defaulted to a `grid` view that never renders the 3D
`SampleGraph`, yet visiting `/library` downloaded all 861 KB of Three.
**Cause:** `import { SampleGraph }` is a **static** import — its entire dependency tree
(Three) is part of the Library route chunk regardless of whether it ever renders.
**Takeaway:** `lazy()` heavy components that sit behind a toggle/secondary view and wrap
them in `Suspense`. The route renders instantly; the heavy deps load only when the view
is actually shown. (Library 41 KB → 14 KB; Three deferred to graph view.)

### 5. Verify bundle behavior empirically, not by grepping chunk-name strings
A built chunk can *reference* another chunk's filename as a string in the
`__vitePreload` dependency manifest without statically importing it — so
`grep vendor-three Library-*.js` gives false positives. Trust instead:
`dist/index.html` modulepreload links, the entry chunk's leading `import` statements,
and a live check of `performance.getEntriesByType('resource')` after a navigation to
confirm what was actually fetched.

### 6. Monaco loads from a CDN (reliability footgun — carry-over, not yet fixed)
`@monaco-editor/react` → `@monaco-editor/loader` fetches Monaco core from jsDelivr at
runtime (the in-build `ts.worker-*.js` ~7 MB is emitted, but the core is CDN-fetched).
The editor and the inline `ChatMessage` script viewer break if the CDN is unreachable.
Fix path: `loader.config({ paths: { vs: '/monaco/...' } })` to self-host, and strip the
unused TS/HTML/CSS/JSON workers (Satie uses a custom Monarch tokenizer, no built-in
language).

### 7. Canvas glow: precompute sprites, don't allocate gradients per frame
RiverCanvas dark mode allocated ~140 `createRadialGradient` calls/frame at full retina
res — the dominant landing-page jank source. Render the glow once per hue bucket to an
offscreen canvas and `drawImage` it (alpha via `globalAlpha`); cap `devicePixelRatio`
(~1.5); throttle to ~30 fps; bail the RAF loop while `document.hidden`. See
`src/ui/components/RiverCanvas.tsx`.
