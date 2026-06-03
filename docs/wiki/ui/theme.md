---
title: Theme — dark/light tokens
subsystem: ui
sources:
  - src/ui/theme/ThemeContext.tsx
  - src/ui/theme/tokens.ts
synced_sha: fc07ec3b901d
synced: 2026-05-31
related: [_index.md]
---

## Purpose
Single source of truth for theme colors/spacing/type, plus the React provider + `useTheme()` hook that hand every component the active `Theme` object so nothing hardcodes hex.

## Why it exists / responsibilities
- **`tokens.ts`** defines the `Theme` contract and the two static presets `LIGHT` / `DARK`, the `MONACO_LIGHT` / `MONACO_DARK` editor token themes, the `PASTELS` palette used by fade mode, and layout scales (`SPACE`, `RADIUS`, `SHADOW`, `SHADOW_DARK`, `FONT`). The light theme preserves the project palette anchors exactly: bg `#f4f3ee`, text `#0a0a0a`, accent `#1a3a2a`, danger `#8b0000` (`src/ui/theme/tokens.ts:9`).
- **`ThemeContext.tsx`** owns the single `useDayNightCycle()` instance for the whole tree (so the rAF pastel-drift + chime animation runs once), adds a new `'system'` mode that follows `prefers-color-scheme`, persists the chosen mode to `localStorage`, and pushes the focus-ring color to a CSS variable.
- Together they let any component call `useTheme()` and paint from tokens instead of literals — the rule behind lessons.md #8.

## Mental model
There are four user-selectable modes but only two color *families* for boolean checks:

```
ThemeMode (stored)      legacyMode fed to useDayNightCycle   resolvedMode (consumers)
  'light' ───────────────▶ 'light' ─────────────────────────▶ 'light'
  'fade'  ───────────────▶ 'fade'  (pastel drift drives bg) ─▶ 'light'
  'dark'  ───────────────▶ 'dark'  ─────────────────────────▶ 'dark'
  'system'─(matchMedia)──▶ 'light'|'dark'  + static LIGHT/DARK preset
```

`mode` is what the user picked and what's persisted. `theme` is the live `Theme` object to paint from. `resolvedMode` collapses `fade`→`light` and `system`→OS pref so consumers can do a simple `resolvedMode === 'dark'` check.

For `'system'`, the provider hands back the **static** `LIGHT`/`DARK` preset (not the legacy hook's value, which could be a leftover fade gradient). For every other mode it defers to `useDayNightCycle` so its pastel drift can drive `theme.bg`.

## Key types & functions
- `interface Theme` — the contract every primitive paints from: `bg/text/textMuted/border/cardBg/cardBorder/invertedBg/invertedText`, `accent/accentText/accentBgSubtle/danger/warn/cardBgSubtle`, the **overlay** tokens (`overlayBg/overlayText/overlayBorder`, which stay dark/light in *both* modes for WebGL chrome), `focusRing`, and nested `monaco` (`src/ui/theme/tokens.ts:54`).
- `interface MonacoTheme` / `MonacoTokens` — editor background/foreground/selection/cursor + per-rule syntax token colors mirroring `SatieEditor` rule names (`src/ui/theme/tokens.ts:35`, `src/ui/theme/tokens.ts:15`).
- `type ThemeMode = 'light' | 'dark' | 'fade' | 'system'` (`src/ui/theme/tokens.ts:12`).
- `LIGHT: Theme` (`src/ui/theme/tokens.ts:178`) and `DARK: Theme` (`src/ui/theme/tokens.ts:203`) — the static presets.
- `PASTELS: PastelPalette[]` — 10 gradient stops for fade mode (`src/ui/theme/tokens.ts:101`).
- `SPACE` / `RADIUS` / `SHADOW` / `SHADOW_DARK` / `FONT` — layout/type scales (`src/ui/theme/tokens.ts:231`–`src/ui/theme/tokens.ts:255`).
- `ThemeProvider({ children })` — app-wide provider; mount once near the root (`src/ui/theme/ThemeContext.tsx:61`).
- `useTheme(): ThemeContextValue` — returns `{ theme, mode, setMode, resolvedMode }`. If a provider is mounted above it returns the shared context; otherwise it falls back to `useStandaloneTheme()` so un-migrated pages still work (`src/ui/theme/ThemeContext.tsx:141`).
- `ThemeContextValue` — `{ theme, mode, setMode, resolvedMode }` (`src/ui/theme/ThemeContext.tsx:18`).
- Internal helpers: `loadStoredMode()` (`src/ui/theme/ThemeContext.tsx:28`), `getSystemMode()` (`src/ui/theme/ThemeContext.tsx:40`), `resolveMode()` (`src/ui/theme/ThemeContext.tsx:45`), `useStandaloneTheme()` fallback (`src/ui/theme/ThemeContext.tsx:152`).

## Data flow
- **Calls in:** every UI component that needs colors calls `useTheme()` — e.g. [editor-workspace](./editor-workspace.md), [ai-panel](./ai-panel.md), [viewport](./viewport.md), [chat](./chat.md), and `src/ui/components/primitives/` (which import the layout tokens directly from `tokens.ts`). `SatieEditor` consumes `theme.monaco` to build its Monaco color theme.
- **Calls out:** `ThemeProvider` (and the standalone fallback) drives `useDayNightCycle()` (`../ui/hooks.md`) for the legacy `light/dark/fade` animation, reads/writes `localStorage` under `STORAGE_KEY = 'satie-theme-mode'` (`src/ui/theme/ThemeContext.tsx:16`), and listens to `window.matchMedia('(prefers-color-scheme: dark)')` for `'system'` mode.
- **Side effect:** on every theme change it sets `document.documentElement.style --satie-focus` to `theme.focusRing` so the global `:focus-visible` ring matches (`src/ui/theme/ThemeContext.tsx:113`).

## Invariants & gotchas
- **Paint from theme tokens, never hardcode hex** (lessons.md #8). Hardcoding the light palette (`#faf9f6`, `#f0efe8`, `#d0cdc4`, `#1a3a2a`, `#1a1a1a`, …) breaks dark mode. Two traps that hide hardcoded colors:
  - **Module-level `CSSProperties` objects can't see `theme`** — they're evaluated once at import, before any theme exists. Convert them to functions that take `theme` (`contentStyle(theme)`) or define them inside the component. This was the DocsPanel `navStyle`/`navBtnStyle`/`contentStyle` bug.
  - **An element with only `opacity` and no explicit `color` inherits a non-theme color** and vanishes on the opposite background. Always set a themed `color` (use `theme.textMuted` for placeholder/status text, not `opacity: 0.2`).
  - Check for regressions: `grep -nE "#faf9f6|#f4f3ee|#f0efe8|#d0cdc4|#e8e0d8|'#1a1a1a'|'#1a3a2a'" src/ui/components/*.tsx`, then verify both modes via screenshot.
- **`overlayBg/overlayText/overlayBorder` are intentionally mode-invariant** — floating chrome over WebGL stays dark-bg/light-text in both light and dark, so do NOT swap them when adding overlay UI.
- **`Theme.mode` is only `'light' | 'dark' | 'fade'`** (never `'system'`) — `'system'` is resolved away before it reaches the `Theme`. For dark checks prefer `resolvedMode === 'dark'` from `useTheme()`.
- **`useTheme()`'s provider/fallback branch is "conditional" but safe** — a component's ancestor tree is stable across renders, so a tree without a provider never gains one mid-render; the `eslint-disable react-hooks/rules-of-hooks` on the fallback is deliberate (`src/ui/theme/ThemeContext.tsx:147`).
- The standalone fallback adapts the narrow legacy setter (no `'system'`): when asked for `'system'` it persists the intent and forwards the OS-resolved value to the hook (`src/ui/theme/ThemeContext.tsx:178`).
- `matchMedia` listeners use `addEventListener` with an `addListener` fallback for older Safari.

## Change checklist
- **Adding a `Theme` field:** add it to `interface Theme` and to BOTH `LIGHT` and `DARK` presets (and the `'system'` path inherits them automatically). Pick a value that reads correctly in each family.
- **Adding a mode:** extend `ThemeMode`, `loadStoredMode()`'s validation, `resolveMode()`, the `legacyMode` mapping, and the `theme` memo in `ThemeProvider`; mirror in `useStandaloneTheme`.
- **Touching Monaco colors:** update `MONACO_LIGHT`/`MONACO_DARK` and confirm the `MonacoTokens` keys still match `SatieEditor`'s tokenizer rule names.
- **New component:** read `useTheme()`; do not introduce module-level hardcoded-hex style objects (lessons.md #8).
- **This file changed?** Per `.claude/rules/wiki.md`, update this wiki page in the same commit.

## Sources
- `src/ui/theme/ThemeContext.tsx`
- `src/ui/theme/tokens.ts`
