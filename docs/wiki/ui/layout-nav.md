---
title: Layout & navigation — Header, Sidebar, Splash, route fallbacks
subsystem: ui
sources:
  - src/ui/components/Header.tsx
  - src/ui/components/Sidebar.tsx
  - src/ui/components/SplashScreen.tsx
  - src/ui/components/RouteFallback.tsx
  - src/ui/components/ErrorBoundary.tsx
synced_sha: aa7b45aa5a5d
synced: 2026-05-31
related: [_index.md, ../lib/performance.md]
---

## Purpose

The chrome around the app: top `Header` nav, the editor's vertical `Sidebar` transport/toggle rail, the intro `SplashScreen`, and the route-level loading/error fallbacks plus a render `ErrorBoundary`.

## Why it exists / responsibilities

- **Header** — top bar on the marketing/list pages (`/`, `/explore`, `/library`, `/sketches`). Owns: logo, center nav tabs (with active-state derived from the URL), theme toggle, background-music toggle, auth/avatar, and a slide-down "Account & Credits" panel (credit balance + Stripe top-up, community-sample preference, API-key entry, AI-learning dashboard). It also **warms the next route's code chunk on link hover/focus** via `preloadRoute`.
- **Sidebar** — the 72px-wide vertical rail used inside the Editor. Owns: play/stop transport, elapsed-time + voice-count readout, master volume, panel visibility toggles (samples / voices / AI), popover toggles (docs / export / versions), save, public/private toggle, share-link copy, docs, and avatar/sign-in. It is purely controlled — every action is a prop callback; it holds no app state.
- **SplashScreen** — full-screen black intro shown during cold start. Renders a logo reveal + optional 3-step onboarding with bespoke Web Audio sound design and a floating dust-mote canvas. Its real job is to occupy "dead time" so route chunks can preload behind it.
- **RouteFallback / RouteErrorFallback** — Suspense fallback while a lazy route chunk loads, and the recovery screen when a chunk import fails permanently.
- **ErrorBoundary** — class component that catches render errors in a subtree so one panel crash doesn't take down the whole app.

## Mental model

Two different shells for two contexts:

```
Marketing/list pages          Editor workspace
┌──────── Header ────────┐    ┌──┬──────────────────┐
│ logo  tabs   user/$    │    │S │   editor + 3D    │
├────────────────────────┤    │i │   + panels       │
│  page (lazy route)     │    │d │                  │
│  └ Suspense → Route-   │    │e │                  │
│    Fallback while chunk│    │b │                  │
│    loads               │    │ar│                  │
└────────────────────────┘    └──┴──────────────────┘
```

Splash runs once before any of this, deliberately burning ~3s of wall time while `preloadCommonRoutes()` (called elsewhere, see [performance](../lib/performance.md)) warms tab chunks. By the time the user clicks a tab, its chunk is cached and the Suspense fallback never shows.

## Key types & functions

- `Header({ theme, mode, setMode, rightExtra })` — `src/ui/components/Header.tsx:119`. `rightExtra` is an arbitrary node slotted into the right control group (e.g. a stop button). Active tab is derived from `location.pathname` at `src/ui/components/Header.tsx:141`.
- Nav tabs array (create / explore / library) — `src/ui/components/Header.tsx:200`; the per-tab `onMouseEnter`/`onFocus` call `preloadRoute(tab.to)` — `src/ui/components/Header.tsx:252`.
- `handleAddCredits(amount)` — `src/ui/components/Header.tsx:171`. POSTs to `/api/stripe/checkout` with the Supabase session bearer token, redirects to the returned Stripe URL. Balance fetched from `/api/stripe/status` in the effect at `src/ui/components/Header.tsx:153`.
- `handleSaveKey(field, value)` — `src/ui/components/Header.tsx:195`. Writes an API key to settings (`saveSettingsKey`) and local state.
- `PanelVisibility` (`samples`/`voices`/`ai`) and `PopoverType` (`'docs'|'export'|'versions'|null`) — `src/ui/components/Sidebar.tsx:7` and `:13`.
- `Sidebar(props)` — `src/ui/components/Sidebar.tsx:35`. Notable props: `isDirty` drives the save-button glow; `canSave` gates the save/public/versions buttons; `onTogglePopover` is the single popover mux.
- `handleShareCopy()` — `src/ui/components/Sidebar.tsx:97`. Copies `${origin}/s/${sketchId}` to the clipboard; no-op unless `isPublic && sketchId`.
- `SplashScreen({ onComplete, showTutorial })` — `src/ui/components/SplashScreen.tsx:177`. Phase machine: `0` logo-in → `1` logo-hold → `2` onboarding → `3` fade-out; `onComplete` fires ~900ms after entering phase 3. `showTutorial={false}` skips straight to fade-out after the logo hold (`src/ui/components/SplashScreen.tsx:196`).
- Splash timeline effect — `src/ui/components/SplashScreen.tsx:185`; keyboard handler (Enter/Space advance, Escape skip) — `src/ui/components/SplashScreen.tsx:233`.
- `RouteFallback()` — `src/ui/components/RouteFallback.tsx:9`. Centered `Spinner`; used as the `<Suspense fallback>` for lazy routes.
- `RouteErrorFallback()` — `src/ui/components/RouteFallback.tsx:31`. "This page failed to load" + a button that calls `window.location.reload()`.
- `ErrorBoundary` class — `src/ui/components/ErrorBoundary.tsx:18`. Props `{ children, fallback?, name? }`; `getDerivedStateFromError` at `:21`, `handleRetry` clears the error at `:29`.

## Data flow

- **Header** reads auth from `useAuth()`, theme mode is lifted to the parent via `setMode`, SFX from `useSFX()`, and music state from `useMusicEnabled()`. It imports `preloadRoute` from `src/lib/routePreload.ts` — the import specifiers there must match what `main.tsx` lazy-loads so the warmed chunk is reused. See [performance](../lib/performance.md).
- **Sidebar** is fully driven by the Editor: transport (`onPlay`/`onStop`/`onMasterVolume`), panel toggles (`onTogglePanel`), popovers (`onTogglePopover`), and save/share (`onSave`/`onTogglePublic`). It only reaches outward for `useAuth`, `useSFX`, `useTheme`, and `useNavigate`. The panels it toggles live in the editor workspace — see [editor-workspace](./editor-workspace.md) and the panel list in [pages](./pages.md).
- **SplashScreen** is self-contained: its own `AudioContext` (lazily created/resumed in `ctx()`), its own dust-mote `requestAnimationFrame` loop, and a single `onComplete` callback out. It does not import the audio engine.
- **RouteFallback / RouteErrorFallback** are wired in the router (`main.tsx`) as the Suspense fallback and the error fallback for `lazyWithRetry` routes (`src/lib/lazyWithRetry.ts`).
- **ErrorBoundary** wraps individual panels/routes; on catch it logs the component stack and renders either the provided `fallback` or a built-in retry card.

## Invariants & gotchas

- **Code-split routes need all three of: route-level error boundary + real Suspense fallback + chunk preload.** Missing any one yields a perceived freeze (URL changes, nothing renders). `RouteFallback` is the Suspense half, `RouteErrorFallback` + `lazyWithRetry` the recovery half, and `preloadRoute` (Header hover/focus, splash idle) the warm-up half. See lessons.md #1.
- **Editor is intentionally NOT preloaded from the top nav.** `preloadCommonRoutes()` warms only explore/library/sketches; Editor pulls in Three.js (~861KB) and is reached by a deliberate "open sketch" action, so it loads on demand. Don't add `/editor` to the splash-warm set. See lessons.md #1 and #3.
- **Preload import specifiers must exactly match the lazy imports in `main.tsx`** or the browser double-fetches the chunk instead of reusing it. See lessons.md #1; details in [performance](../lib/performance.md).
- **No hardcoded hex for themed surfaces.** Header and Sidebar paint from `theme.*` tokens (and `RouteFallback` reads `useTheme()`). An element with only `opacity` and no `color` inherits a non-theme color and vanishes in the opposite mode. SplashScreen and the `ErrorBoundary` default card are the deliberate exceptions — they hardcode (`#0a0a0a`, `#f4f3ee`, `#8b0000`) because they render outside/around the theme provider. See lessons.md #8.
- **Header active-page logic is path-prefix based**: `/` → create, `startsWith('/explore')` → explore, etc. The "sketches" tab only renders when a user is signed in.
- **Sidebar share button is always rendered when `sketchId` exists but disabled when private** — sharing a private sketch is blocked at the click handler (`onClick={isPublic ? handleShareCopy : undefined}`), not just visually.
- **Splash uses its own `AudioContext`**, created lazily and resumed on use; it must be triggered by a user gesture path to actually produce sound (browser autoplay constraint). The dust-mote loop cancels its RAF and removes the resize listener on unmount.
- **ErrorBoundary only catches render-phase errors**, not async/event-handler errors — those still need try/catch at the call site (e.g. Header's Stripe fetches).

## Change checklist

- Adding a top-nav tab: update the `tabs` array in `Header.tsx`, wire `preloadRoute(tab.to)` on hover/focus, and add the route's importer to `src/lib/routePreload.ts` (and decide whether it belongs in `preloadCommonRoutes`).
- Adding a Sidebar panel toggle: extend `PanelVisibility` (`Sidebar.tsx:7`), add the button + icon, and thread the new key through the Editor's `panels` state and `onTogglePanel` — see [editor-workspace](./editor-workspace.md).
- Adding a Sidebar popover: extend `PopoverType` (`Sidebar.tsx:13`) and the `onTogglePopover` union.
- Changing splash timing/steps: edit the `STEPS` array and the timeline effect; keep total duration aligned with `preloadCommonRoutes` so chunks finish warming before `onComplete`.
- Adding a new lazy route: pair it with `RouteFallback` (Suspense) and `RouteErrorFallback` + `lazyWithRetry`, and register its importer in `routePreload.ts`.
- Any color change in Header/Sidebar/RouteFallback: use `theme.*` tokens, verify both light and dark modes (lessons.md #8).

## Sources

- src/ui/components/Header.tsx
- src/ui/components/Sidebar.tsx
- src/ui/components/SplashScreen.tsx
- src/ui/components/RouteFallback.tsx
- src/ui/components/ErrorBoundary.tsx
