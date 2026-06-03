---
title: UI — app structure & routing
subsystem: ui
sources:
  - src/App.tsx
  - src/main.tsx
synced_sha: 149229da8f08
synced: 2026-05-31
related: [pages.md, editor-workspace.md, viewport.md, chat.md, hooks.md, theme.md, layout-nav.md]
---

## Purpose

The React app shell: provider stack, splash gate, and the lazy-loaded route table that maps URLs to pages.

## Why it exists / responsibilities

`src/main.tsx` is the single entry point. It owns:

- The React root and provider nesting (`BrowserRouter` → `AuthProvider` → `ThemeProvider`).
- The splash gate: nothing routes until the `SplashScreen` finishes.
- The route table (URL → page component).
- Code-splitting policy: only `Chat` is eager; every other page is a lazy chunk warmed during the splash.
- Top-level error and suspense fallbacks for routes.

`src/App.tsx` is a backwards-compat shim only — it re-exports `Editor` as its default and contains no routing logic. The comment header in it is stale (it claims Dashboard is at `/`; the real landing route is `Chat`).

## Mental model

```
main.tsx
  StrictMode
    BrowserRouter            ← URL ↔ history
      AuthProvider           ← session / OAuth (lib/AuthContext)
        ThemeProvider        ← day/night theme (ui/theme/ThemeContext)
          App()
            SplashScreen     ← blocks until onComplete fires
            ErrorBoundary
              Suspense       ← RouteFallback while a lazy chunk loads
                Routes       ← the route table
```

Think of `App()` as a two-phase component: phase 1 renders only the splash; phase 2 (after `splashDone`) renders the routed app. The provider stack wraps *both* phases, so auth/theme are live during the splash.

## Key types & functions

- `App()` — the shell component; holds `splashDone` state and the splash gate. src/main.tsx:26
- `handleSplashComplete()` — flips `splashDone`, marks onboarding done in `localStorage` (`satie-onboarding-done`). src/main.tsx:30
- Route-warming effect — on mount, schedules `preloadCommonRoutes()` via `requestIdleCallback` (600ms `setTimeout` fallback). src/main.tsx:41
- Lazy route declarations via `lazyRoute(...)` — `Editor`, `Dashboard`, `Gallery`, `SketchView`, `Embed`, `UserProfile`, `Library`, `NotFound`. src/main.tsx:17
- `Chat` — the only eager page import (must paint instantly). src/main.tsx:9
- `<Routes>` table. src/main.tsx:58
- Root render with provider stack. src/main.tsx:75

### Route table (src/main.tsx:58)

| Path | Element | Lazy |
|------|---------|------|
| `/` | `Chat` | no (eager) |
| `/sketches` | `Dashboard` | yes |
| `/editor` | `Editor` | yes |
| `/editor/:sketchId` | `Editor` | yes |
| `/explore` | `Gallery` | yes |
| `/s/:id` | `SketchView` | yes |
| `/embed/:id` | `Embed` | yes |
| `/library` | `Library` | yes |
| `/u/:username` | `UserProfile` | yes |
| `*` | `NotFound` | yes |

Note: the editor route param is named `sketchId` here (CLAUDE.md's routing summary lists it as `:id` — `main.tsx` is authoritative).

## Data flow

- **Calls in:** the browser loads `index.html` → `main.tsx` mounts the root.
- **Calls out:**
  - `lazyRoute` (from `src/lib/lazyWithRetry.ts`) wraps each `import()` with retry + stale-chunk reload, so a navigation after a deploy that invalidated old chunks self-heals instead of white-screening.
  - `preloadCommonRoutes()` (from `src/lib/routePreload.ts`) prefetches the top-nav chunks during idle time.
  - `AuthProvider` (`src/lib/AuthContext`) and `ThemeProvider` (`src/ui/theme/ThemeContext`, see [theme](./theme.md)) supply context consumed by every page.
  - `ErrorBoundary` / `RouteFallback` / `RouteErrorFallback` guard the route subtree.
- **Pages reached from here:** [Chat](./chat.md), the [Editor workspace](./editor-workspace.md), and the rest enumerated in [pages](./pages.md). The 3D [viewport](./viewport.md) and [hooks](./hooks.md) live inside those pages, not the shell.
- **Engine ↔ UI boundary:** the shell never touches the audio engine. The engine is reached only inside pages via `useSatieEngine` (see [hooks](./hooks.md)); the shell's job ends at routing a page component into view.

## Invariants & gotchas

- **`Chat` must stay eager.** It is the landing page and must paint without a chunk fetch. Do not convert it to `lazyRoute`.
- **Splash gates everything.** While `!splashDone`, `App()` returns *only* `<SplashScreen>` — no `<Routes>` render. Anything that must run before first paint of a route belongs after the splash, or in a provider.
- **Onboarding is one-shot.** `showTutorial` reads `localStorage('satie-onboarding-done')` once at render; `handleSplashComplete` writes it. Clearing that key re-shows the tutorial.
- **Preload is mount-driven, not splash-driven.** The warming effect runs on mount (not gated on the splash finishing) because that idle window is exactly when the user can't click yet.
- **`App.tsx` is a shim** — editing it does not change routing. All route changes go in `main.tsx`.
- **`StrictMode`** double-invokes effects in dev; the preload effect is idempotent (it cancels its idle callback / timeout on cleanup) so this is safe.

## Change checklist

When changing the shell:

1. Adding a page → add a `lazyRoute(...)` const and a `<Route>` in the table (src/main.tsx:17, :58). Default to lazy; only Chat is eager.
2. New top-nav destination → consider adding its chunk to `preloadCommonRoutes()` in `src/lib/routePreload.ts`.
3. New global context/provider → nest it inside the existing stack in the root render (src/main.tsx:75), inside `ThemeProvider` unless it must wrap routing/auth.
4. Changing a route param name → update both `main.tsx` and the consuming page's `useParams` call (e.g. `sketchId`).
5. Update CLAUDE.md's routing section if the user-facing URL map changes.
6. Update the wiki: this page plus [pages](./pages.md).

## Sources

- `src/App.tsx`
- `src/main.tsx`
