---
title: Editor workspace — Editor, SatieEditor, Panel
subsystem: ui
sources:
  - src/ui/pages/Editor.tsx
  - src/ui/components/SatieEditor.tsx
  - src/ui/components/Panel.tsx
synced_sha: 3b430a76e064
synced: 2026-06-03
related: [viewport.md, ai-panel.md, panels-assets.md]
---

## Purpose

The `/editor` workspace: a zoomable canvas of draggable/resizable floating panels (Monaco script editor, 3D viewport, AI, assets, voices) wired to one shared `SatieEngine`.

## Why it exists / responsibilities

`Editor.tsx` is the main composition surface. It owns:

- The script text, sketch title, public flag, and per-sketch viewport background color.
- The engine connection (via `useSatieEngine`) and the run loop (`loadScript` + `play`).
- Sketch lifecycle: load by `:sketchId`, autosave (2 s debounce), explicit save (which also uploads samples + thumbnail + version snapshot), dirty tracking.
- Sample/trajectory loading, AI generation handlers, RLHF edit-distance feedback.
- Panel visibility, the CSS-transform workspace zoom, and popover overlays (docs/export/versions).

`SatieEditor.tsx` wraps Monaco: it registers the `satie` language once (tokenizer, themes, completion, hover) and runs debounced live validation.

`Panel.tsx` is the reusable floating-panel chrome: drag, resize-from-8-edges, viewport clamping, and localStorage layout persistence — all correct under an ancestor CSS scale.

## Mental model

```
Editor (page)
├─ Sidebar (transport, panel toggles, save/share)
└─ workspace container  ── CSS transform: scale(workspaceZoom)
   ├─ PatchCord (SVG behind panels, AI→target)
   ├─ Panel "score"   → SatieEditor (Monaco) + Run bar   [always]
   ├─ Panel "space"   → SpatialViewport                  [always]
   ├─ Panel "samples" → AssetPanel                        [toggle]
   ├─ Panel "voices"  → VoicesPanel (mixer)               [toggle]
   └─ Panel "ai"      → AIPanel                            [toggle]
   (popovers: export / docs / versions render OUTSIDE the
    scaled container so they stay at native size)
```

Every visible panel lives inside one scaled `<div>`. Panels position themselves with `left/top` in that container's pre-transform coordinate space; the zoom is a single `transform: scale()` on the wrapper. Drag/resize math divides screen-pixel mouse deltas by the measured ancestor scale to stay aligned with the cursor.

## Key types & functions

**Editor page**
- `Editor()` — the page component. src/ui/pages/Editor.tsx:241
- `VoicesPanel` — memoized per-voice mute/solo mixer; lists `uiState.statements` with kind/clip, `every`, DSP badges (`rv`/`dl`/`fl`), wander tag. src/ui/pages/Editor.tsx:60
- `PatchCord` — SVG bezier "patch cord" from the AI panel to its target panel (`score` or `samples`); rAF-throttled to ~15 fps, reads `getBoundingClientRect` and divides by parent scale. src/ui/pages/Editor.tsx:170
- `handleRun` — `loadScript(script)` then `play()` if not already playing. src/ui/pages/Editor.tsx:439
- `handleSave` — embeds `- @bg #hex` metadata, creates/updates sketch, captures engine `AudioBuffer`s → WAV, uploads samples, saves a version, uploads a thumbnail. src/ui/pages/Editor.tsx:616
- `handleAIGenerate` — flushes prior-gen edit feedback, sets script, auto-runs. src/ui/pages/Editor.tsx:483
- `handleGenerateTrajectory` — executes generated trajectory code → LUT, registers + caches it. src/ui/pages/Editor.tsx:539
- `flushEditFeedback` / `handleFeedbackCreated` — RLHF: measure user edits against the last AI baseline via `editDistanceRatio`. src/ui/pages/Editor.tsx:467
- `workspaceZoom` state + zoom controls (0.25–2.0, default 0.9); container sized `100/zoom %` with `transform: scale(zoom)`, origin top-left. src/ui/pages/Editor.tsx:304, src/ui/pages/Editor.tsx:872
- Mobile gate: returns a "needs desktop" screen under 768px. src/ui/pages/Editor.tsx:699

**SatieEditor**
- `SatieEditor(props)` — Monaco wrapper. Props: `value`, `onChange`, `onRun`, `errors`, `runtimeWarnings`, `communitySamples`. src/ui/components/SatieEditor.tsx:329
- `registerSatieLanguage(monaco)` — one-time (`languageRegistered` guard): registers the `satie` language, Monarch tokenizer, light/dark themes, completion + hover providers. src/ui/components/SatieEditor.tsx:133
- `defineMonacoTheme(...)` — builds a Monaco theme from a `MonacoTheme` token block. src/ui/components/SatieEditor.tsx:91
- `PROPERTY_DOCS` / `KEYWORD_DOCS` — drive both hover tooltips and indented/top-level completion (including the `place` and `move` property docs). src/ui/components/SatieEditor.tsx:33, src/ui/components/SatieEditor.tsx:61
- Enum completion lists — `MOVEMENT_TYPES` (semantic archetypes `static`/`drift`/`dart`/`pass`/… plus low-level `walk`/`fly`/`spiral`/…) fire after `move`; `PLACE_SECTORS`/`PLACE_DEPTHS`/`PLACE_HEIGHTS`/`PLACE_EXTENTS` fire after `place`. The Monarch tokenizer colors the same words. src/ui/components/SatieEditor.tsx
- Live validation effect: 400 ms debounce, calls `parseWithWarnings(value)`, maps errors/warnings to Monaco markers. src/ui/components/SatieEditor.tsx:361
- Cmd/Ctrl+Enter command → `onRun`. src/ui/components/SatieEditor.tsx:347

**Panel**
- `Panel(props)` — floating panel wrapper. Key props: `panelId` (persistence key), `defaultX/Y/Width/Height`, `minWidth/minHeight`, `resizable`, `borderColor`, `compact`. src/ui/components/Panel.tsx:47
- `loadLayout` / `saveLayout` — read/write `satie-panel-<id>` JSON in localStorage. src/ui/components/Panel.tsx:15, src/ui/components/Panel.tsx:26
- `getAncestorScale()` — measures CSS scale via `getBoundingClientRect().width / offsetWidth`. src/ui/components/Panel.tsx:116
- `getClampBounds` / `clampToViewport` — keep ≥40px of the panel reachable, using `parentElement.offsetWidth/Height`. src/ui/components/Panel.tsx:77, src/ui/components/Panel.tsx:86
- Drag/resize move effect: drag uses `translate3d` (composite layer, no reflow), resize writes `left/top/width/height`, both coalesced via rAF, committed to state on mouseup. src/ui/components/Panel.tsx:146

## Data flow

- **In:** route `:sketchId` and `location.state.templateScript/Title`; `useSatieEngine()` provides `engineRef`, `uiState` (throttled snapshot: statements, errors, runtimeWarnings, mute/solo indices, isPlaying, currentTime, trackCount), `tracksRef`, and action callbacks. `useFaceTracking` feeds listener orientation. Community sample names come from `getPopularSampleNames`.
- **Out:** `SatieEditor` renders the script; `SpatialViewport` reads `tracksRef` directly (see [viewport](./viewport.md)); [AIPanel](./ai-panel.md) calls back into `handleAIGenerate` / sample + trajectory handlers; [AssetPanel](./panels-assets.md) loads buffers and generates trajectories; `VoicesPanel` calls `toggleMute`/`toggleSolo`. Persistence goes to `sketches`, `sampleStorage`, `versions`, `thumbnailCapture`, and Supabase.
- `SatieEditor` calls `parseWithWarnings`/`SatieSyntaxError` from the engine for validation only — running the script still goes through `loadScript` in the engine hook.

## Invariants & gotchas

- **Run order:** `loadScript` before `play` — `handleRun` and `handleAIGenerate` both do this; do not reorder.
- **Three.js reads `tracksRef` directly.** Never add React state between the engine and the viewport; the "space" Panel just forwards the ref.
- **Scale-aware drag/resize:** panel motion math divides screen deltas by `getAncestorScale()`. If you nest the workspace under a different transform or change `transformOrigin`, re-verify drag tracking. The drag effect intentionally omits `pos`/`size` from its deps (captured at drag start) — re-adding them detaches listeners mid-drag.
- **Popovers render outside the scaled container** so they stay at native size and full screen height; keep new full-size overlays out of the zoomed wrapper.
- **`@bg` metadata uses `-` comments**, not `#`. Load matches `^- @bg (#hex)$`; save strips both `- @bg` and legacy `# @bg` then re-prepends if non-default (`#f4f3ee`). The Monarch tokenizer treats leading `-` lines as comments.
- **`registerSatieLanguage` is global-once** (`languageRegistered`) and `_communitySampleNames` is a module-level ref synced on every `SatieEditor` render — there is effectively one Satie language registration per page load.
- **Validation is advisory** (markers only); it never blocks running. It re-parses the full script 400 ms after the last keystroke.
- **Autosave vs explicit save differ:** autosave persists only `script`+`title` for an existing sketch; only `handleSave` embeds `@bg`, uploads samples/thumbnail, and saves a version. Dirty state compares against `lastSavedScript`/`lastSavedTitle`.
- **Layout persistence needs `panelId`.** Without it, `loadLayout`/`saveLayout` no-op and the panel always opens at its defaults.
- Mobile gate hard-returns under 768px before any panel renders.

## Change checklist

- Adding a panel: render it inside the scaled workspace `<div>` with a `Panel` wrapper and a unique `panelId`; add the key to `PanelVisibility` and initialize it in `panels` state. (Full steps in CLAUDE.md "Adding a new UI panel".)
- New Satie property/keyword: also update `PROPERTY_DOCS`/`KEYWORD_DOCS`, the Monarch tokenizer keyword groups, and any movement/filter/distortion enum list in `SatieEditor.tsx` so highlighting, hover, and completion stay in sync.
- Changing zoom range or `transformOrigin`: re-verify `getAncestorScale` and `getClampBounds` in `Panel.tsx`.
- Editing any of these three files updates this wiki page in the same commit (see `.claude/rules/wiki.md`).

## Sources

- src/ui/pages/Editor.tsx
- src/ui/components/SatieEditor.tsx
- src/ui/components/Panel.tsx
