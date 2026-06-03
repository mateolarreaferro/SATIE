---
title: UI primitives
subsystem: ui
sources:
  - src/ui/components/primitives/**
synced_sha: 1c8d2429357c
synced: 2026-05-31
related: [_index.md]
---

## Purpose
A small catalog of theme-aware, inline-styled foundation components (Button, IconButton, Card, Pill, SectionLabel, MetaRow, Spinner, EmptyState) re-exported from one barrel.

## Why it exists / responsibilities
These primitives replace ad-hoc inline buttons, caps labels, "loading…" text, and "no items" blocks that were duplicated across pages and panels. Each one reads the active theme via `useTheme()`, derives its sizing/typography from the design tokens in `src/ui/theme/tokens.ts`, and accepts a `style?: CSSProperties` escape hatch for one-off overrides. They are presentational only — no audio, no engine, no routing. Per the barrel's own contract (src/ui/components/primitives/index.ts:5), every primitive: reads theme via `useTheme()`, uses inline styles only, accepts a `style` override, inherits the global `:focus-visible` ring from `interactions.css`, and never emits emoji (icons come in as SVG via `iconLeft` / `iconRight` / `icon`).

## Mental model
Tokens (color/font/radius/shadow) flow into each primitive through `useTheme()`; the primitive picks a palette by `variant`, picks dimensions by `size`, merges `style` last, and renders a single styled element.

```
tokens.ts + ThemeContext ──useTheme()──> primitive ──variant→palette, size→dims, ...style──> <button|div|span>
```

The interactive primitives (Button, IconButton, Pill) are all `forwardRef`'d `<button>`s that spread `...rest` onto the DOM, so they behave like native buttons (onClick, type, disabled). The layout primitives (Card=`<div>`, MetaRow/SectionLabel/EmptyState/Spinner) are plain function components.

## Key types & functions
- `Button` — variant × size button with optional `iconLeft`/`iconRight`, `loading` (swaps icon for a Spinner and disables), and `rounded` (`'md'` | `'pill'`); src/ui/components/primitives/Button.tsx:37. Variants `primary|secondary|ghost|destructive|inverted` (src/ui/components/primitives/Button.tsx:11), sizes `sm|md|lg` → heights 28/36/44 (src/ui/components/primitives/Button.tsx:29).
- `IconButton` — square icon-only button (`size` is the literal `24|32|40`), **requires** an `aria-label` (src/ui/components/primitives/IconButton.tsx:17); variants `ghost|solid|inverted|overlay`, where `overlay` adds a blur backdrop (src/ui/components/primitives/IconButton.tsx:45). Defined at src/ui/components/primitives/IconButton.tsx:23.
- `Card` — bordered container `<div>`; `padding` (default 16, pass 0 to opt out) and `interactive` (adds hover-lift shadow + pointer cursor); src/ui/components/primitives/Card.tsx:18.
- `Pill` — rounded (`RADIUS.pill`) chip-button; variants `default|outline|inverted|overlay`, sizes `sm|md|lg` → heights 24/30/36; src/ui/components/primitives/Pill.tsx:29.
- `SectionLabel` — uppercase, letter-spaced, 45%-opacity caps heading; the only primitive that does **not** call `useTheme()` (color is inherited); src/ui/components/primitives/SectionLabel.tsx:13.
- `MetaRow` — inline flex row that interleaves a separator (default middle dot `·`) between non-falsy children; standard "author · date · stats" layout; src/ui/components/primitives/MetaRow.tsx:16.
- `Spinner` — CSS-rotated SVG ring (`.satie-spin`); `size` (default 14), optional `color` (defaults to theme text), `aria-label` (default "Loading"); src/ui/components/primitives/Spinner.tsx:17. Used internally by `Button`'s loading state.
- `EmptyState` — centered icon/title/description/action block for "no items" surfaces; the `icon` must be an SVG element, never an emoji; src/ui/components/primitives/EmptyState.tsx:20.
- Barrel — `index.ts` re-exports every component plus its prop/variant/size types; src/ui/components/primitives/index.ts:13.

## Data flow
**In:** consumers import from the barrel, e.g. `import { Button, EmptyState } from '@ui/components/primitives'`. Callers include page and panel components such as `SketchView`, `UserProfile`, `Embed`, `NotFound`, and `VersionsPanel`.
**Out:** each primitive calls `useTheme()` (from `src/ui/theme/ThemeContext` — see [theme](./theme.md)) and reads `FONT` / `RADIUS` / `SHADOW` tokens from `src/ui/theme/tokens.ts`. `Button` calls `Spinner` for its loading state. Animations and the focus ring come from `src/ui/styles/interactions.css` (`satie-spin` keyframes, global `:focus-visible`). For the broader UI shell that hosts these, see [_index](./_index.md).

## Invariants & gotchas
- **No emoji.** Icons are passed as SVG (`iconLeft`/`iconRight`/`icon`); `EmptyState` and the barrel doc call this out explicitly. Matches the project no-emoji rule.
- **`IconButton` `aria-label` is mandatory** — the prop type `Omit`s the native `aria-label` and re-requires it as a non-optional string (src/ui/components/primitives/IconButton.tsx:15), so an icon button without a label won't type-check.
- **`Button.loading` implies disabled** — `isDisabled = disabled || loading` (src/ui/components/primitives/Button.tsx:82); a loading button is non-interactive and hides its `iconLeft`/`iconRight`.
- **`style` wins.** Every primitive spreads `...style` after its palette/base style, so caller overrides take precedence over the variant.
- **`SectionLabel` has no theme dependency** — it relies on inherited `color`; if you place it on an off-theme surface, set color via `style`.
- **`MetaRow` filters falsy children** before interleaving separators (src/ui/components/primitives/MetaRow.tsx:18), so conditional `{cond && <span/>}` children won't produce dangling dots.
- The `overlay` variant on `IconButton`/`Pill` uses `backdropFilter: blur(6px)` and the theme's `overlayBg/overlayText/overlayBorder` — intended for use atop the 3D viewport or imagery, not flat backgrounds.

## Change checklist
- Adding a variant/size: extend the variant/size union type, add its entry to the `palettes` record (and `HEIGHT`/`PAD_X`/`FONT_SIZE` maps where present), then re-export the type from the barrel if new.
- Adding a new primitive: create the file under `src/ui/components/primitives/`, follow the barrel contract (theme via `useTheme()`, inline styles, `style` override, no emoji), and add both the `export` and `export type` lines to `index.ts:13` so it isn't tree-shaken out of the public surface — and so the wiki coverage gate sees it.
- New theme color/token used by a primitive: add it to `src/ui/theme/tokens.ts` / `ThemeContext` (see [theme](./theme.md)) before referencing it.
- Touching animation/focus behavior: edit `src/ui/styles/interactions.css` (`satie-spin`, `:focus-visible`), not the component.

## Sources
- src/ui/components/primitives/Button.tsx
- src/ui/components/primitives/IconButton.tsx
- src/ui/components/primitives/Card.tsx
- src/ui/components/primitives/Pill.tsx
- src/ui/components/primitives/SectionLabel.tsx
- src/ui/components/primitives/MetaRow.tsx
- src/ui/components/primitives/Spinner.tsx
- src/ui/components/primitives/EmptyState.tsx
- src/ui/components/primitives/index.ts
