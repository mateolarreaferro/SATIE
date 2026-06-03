---
title: Viewport — SpatialViewport & RiverCanvas
subsystem: ui
sources:
  - src/ui/components/SpatialViewport.tsx
  - src/ui/components/RiverCanvas.tsx
synced_sha: 94a91eaf834e
synced: 2026-05-31
related: [../engine/engine.md, hooks.md]
---

## Purpose
The 3D visualization of the audio scene (`SpatialViewport`, a React Three Fiber canvas) plus the 2D ambient particle backdrop (`RiverCanvas`) used behind the Chat landing page.

## Why it exists / responsibilities
- Render every live voice as a glowing orb/cube + always-on label, positioned in 3D space, updated every frame from the engine's live track array.
- Drive the audio listener: the camera *is* the listener — fly controls move/rotate the camera and push position + forward direction back to the engine via callbacks.
- Provide an `overlayMode` for the Chat landing: transparent WebGL drawn over `RiverCanvas`, wider FOV, fatter/longer trails, drag-anywhere look controls.
- Render scene furniture: infinite grid, world-orientation axis gizmo, heading compass, optional listener face mesh / nose triangle, hearing cone.
- `RiverCanvas` paints a per-theme ambient particle field (light spores / dark starfield+nebula / fade aurora) cheaply enough to sit behind the chat UI.

## Mental model
Two independent canvases stacked by the Chat page. `RiverCanvas` is a plain 2D `<canvas>` (z:0). `SpatialViewport` is a WebGL `<canvas>` that, in overlay mode, clears transparent so the river shows through.

The hot path is one big `useFrame` fan-out — **no React state touches per-frame data**:

```
engine tracks ──(ref)──> AudioSourcePool.useFrame ──> trackRefs[i].current = tracks[i]
                                                          │ (plain ref write, no setState)
                              AudioSource*.useFrame ──────┘──> mesh.position / shader uniforms
```

React only re-renders the pool when *voice count* or a voice's *visual kind* changes (a `slotInfo` state update), never on position/volume/color changes. This is the core perf rule from [the UI rules](../../../.claude/rules/ui.md) and CLAUDE.md: never insert React state between the engine and the viewport.

## Key types & functions
SpatialViewport (`src/ui/components/SpatialViewport.tsx`):
- `SpatialViewport` props/component — `src/ui/components/SpatialViewport.tsx:48`, :1338. Props: `tracksRef`, `bgColor`, `onBgColorChange`, `onListenerMove`, `onListenerRotate`, `overlayMode`, `faceTracking`.
- `SceneInner` — memoized scene graph; picks grid style, lights, controls (`OverlayFlyControls` vs `FlyControls`), gizmo, and Bloom by `overlayMode` — `src/ui/components/SpatialViewport.tsx:1161`.
- `AudioSourcePool` — owns 128 reusable `trackRefs`, the per-frame ref-write loop, and the `slotInfo` re-render gate — `src/ui/components/SpatialViewport.tsx:449` (`MAX_VOICES = 128` at :442).
- `resolveVisualKind(visual)` → `'none'|'sphere'|'cube'|'trail'|'trail+sphere'|'trail+cube'` — `src/ui/components/SpatialViewport.tsx:83`.
- Voice components: `AudioSourceOrb` :234 (shader orb, used for `none`/`sphere`), `AudioSourceCube` :269, `AudioSourceTrailOrb` :316, `AudioSourceTrailCube` :381. All four call `useLabelFrame`.
- `useLabelFrame(trackRef, labelRef, posRef)` — positions the label sprite each frame and re-bakes a rounded-pill canvas texture only when the cleaned clip name changes — `src/ui/components/SpatialViewport.tsx:145`. `LabelSprite` at :224.
- Orb visuals: `ORB_VERTEX`/`ORB_FRAGMENT` GLSL + `makeOrbMaterial()` (additive-blended circular shader disc, `sharedPlaneGeo` = `CircleGeometry`) — `src/ui/components/SpatialViewport.tsx:98`–:141.
- `remapColor(trackColor, isDarkBg, seed)` — remaps the default `#1a3a2a` voice color to a light palette so voices stay visible on dark/overlay backgrounds — `src/ui/components/SpatialViewport.tsx:22`.
- `AxisGizmo` — three `THREE.Line` axes (X red / Y green / Z blue) pinned to the bottom-left of the screen, rotated to show world orientation; non-overlay only — `src/ui/components/SpatialViewport.tsx:512`.
- `FlyControls` (editor) — `src/ui/components/SpatialViewport.tsx:920`; `OverlayFlyControls` (chat) — :738. Both: drag to look, WASD/QE to fly, wheel to dolly, double-click to teleport; both sync camera → listener each frame.
- Listener visuals: `Listener` (nose triangle or `FaceMeshViz`) :657, `HearingCone` :695, `HeadingIndicator` (2D compass canvas) :1249.
- Contexts threaded into the scene: `OverlayModeContext`, `DarkBgContext`, `ListenerSyncContext`, `ViewportFocusContext`, and `CameraReset/Zoom/Fit` refs — `src/ui/components/SpatialViewport.tsx:9`–:46.

RiverCanvas (`src/ui/components/RiverCanvas.tsx`):
- `RiverCanvas({ mode })` — the component; sizes canvas, builds particles, runs the throttled RAF loop — `src/ui/components/RiverCanvas.tsx:220`.
- `MODE_CONFIG` — maps each `ThemeMode` to a `{ create, draw }` pair (`light`/`dark`/`fade`, `system` → light) — `src/ui/components/RiverCanvas.tsx:211`.
- `drawLight` :44 / `drawDark` :88 / `drawFade` :144 — per-mode draw functions; `PARTICLE_COUNT = 140` at :206.
- `glowSprite(hue)` — precomputed offscreen radial-gradient sprite, bucketed per 10° of hue, cached in `glowSpriteCache` — `src/ui/components/RiverCanvas.tsx:179` (`GLOW_SPRITE_RADIUS = 48` at :176).

## Data flow
- **In:** the Chat page / Editor pass `tracksRef` (the engine's live track array from [the engine](../engine/engine.md), exposed by [hooks](./hooks.md) `useSatieEngine`), plus `bgColor`, listener callbacks, and `overlayMode`. `RiverCanvas` receives `mode` from `useDayNightCycle` on the Chat page.
- **Per frame (read):** `AudioSourcePool.useFrame` reads `tracksRef.current`; each voice's `useFrame` reads `track.position/volume/alpha/color/seed/statement.visualSize`.
- **Out:** fly controls call `onListenerMove(x,y,z)` and `onListenerRotate(fx,fy,fz, ux,uy,uz)` every frame, plus write `listenerPosRef`/`listenerForwardRef` (shared with `Listener`, `HearingCone`, `HeadingIndicator`). The parent wires these into the engine's listener (HRTF panner).
- **Background color:** persisted as a `# @bg #hex` comment in the script (see CLAUDE.md); `BgColorUpdater` and the `onCreated` clear color apply it; transparent in overlay mode.

## Invariants & gotchas
- **No React state in the per-frame loop.** Track data flows through plain refs; `AudioSourcePool` only `setState` when count/visual-kind changes. Adding state here regresses the whole viewport (see [hooks](./hooks.md), `.claude/rules/ui.md`).
- **Every voice always renders a sphere/orb + label**, regardless of the `visual` property. `none` and `sphere` both map to `AudioSourceOrb`; `trail` and `trail+sphere` both map to `AudioSourceTrailOrb`. The `visual` property only adds trails/cubes on top.
- The orb uses a **circular** `CircleGeometry` disc (not a square plane) and a smooth `edgeFade` in the fragment shader so Bloom never catches a hard square outline — `src/ui/components/SpatialViewport.tsx:117`,:127.
- Bloom + axis gizmo + heading indicator + bottom controls are **disabled in overlay mode**; overlay uses fatter trails (`width 3`, `length 140` vs `1.2`/`80`) and a 65° FOV camera (vs 55°) — :362, :417, :1443.
- `isDarkBg` is forced `false` in overlay mode (page bg is light by default), so voice color remapping uses the light palette — :1164.
- Camera *is* the listener in both modes; there is no separate listener-position control. `FlyControls` skips orientation sync when `externalTrackingActive` (face/head tracking owns rotation) — :1139.
- `MAX_VOICES = 128`; extra tracks beyond that are not visualized.
- Labels strip trailing generation indices (`_0`, `_1`) and underscores and only re-bake the texture on change — cheap, but the regex strips two trailing `_\d+` groups, not arbitrarily many — `src/ui/components/SpatialViewport.tsx:161`.
- **RiverCanvas performance — lesson #7** (`docs/lessons.md`): allocating ~140 `createRadialGradient` calls/frame at retina res was the dominant landing jank. Mitigations baked in here: precomputed `glowSprite` cache (one sprite per hue bucket, drawn via `drawImage` with `globalAlpha`), DPR capped at 1.5, ~30 fps throttle (`FRAME_MS`), and the RAF loop bails while `document.hidden` — `src/ui/components/RiverCanvas.tsx:179`,:238,:255,:262. Related: code-splitting the Three-heavy viewport (lesson #3/#4) keeps first paint light.
- `RiverCanvas` is `pointerEvents:none` at z:0 — it never intercepts camera/chat input.

## Change checklist
- New `visual` kind: extend `VisualKind` and `resolveVisualKind` (:81/:83), add the voice component, wire it into the `AudioSourcePool` switch (:496), and the engine-side `Statement.visual` parsing.
- New listener/scene gadget: add it inside `SceneInner` (:1161) and gate on `overlayMode` if it should not show over chat.
- Changing listener wiring: update both `FlyControls` and `OverlayFlyControls` (they duplicate the camera→listener sync) and the parent's `onListenerMove/Rotate` handlers.
- New `RiverCanvas` theme behavior: add a `{ create, draw }` entry to `MODE_CONFIG` (:211); keep the gradient-per-frame rule from lesson #7.
- Per the [wiki rules](../../../.claude/rules/wiki.md), edit this page in the same commit as any change to the two source files.

## Sources
- `src/ui/components/SpatialViewport.tsx`
- `src/ui/components/RiverCanvas.tsx`
