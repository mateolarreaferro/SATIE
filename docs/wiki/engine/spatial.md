---
title: Spatial — trajectories & generation
subsystem: engine
sources:
  - src/engine/spatial/Trajectories.ts
  - src/engine/spatial/TrajectoryGen.ts
synced_sha: 9dd5f0466078
synced: 2026-06-03
related: [engine.md, export.md, ../dsl/spatial-movement.md]
---

## Purpose

Named 3D movement paths that map a normalized time `t` to a normalized `{x,y,z}` position — both built-in analytic curves and AI-generated, pre-computed custom paths.

## Why it exists / responsibilities

A voice with `move <name>` needs a position for every audio frame. This module owns:

- The **trajectory registry** — a name → `Trajectory` map shared process-wide.
- Two evaluation strategies behind one `Trajectory` interface: **analytic** (compute position from `t` on the fly) and **LUT** (sample a pre-computed table and lerp).
- The **builtins**: `spiral`, `orbit` (analytic), `lorenz` (LUT, RK4-integrated attractor), and the four analytic linear traverses `line_lr`/`line_rl`/`line_toward`/`line_away` emitted by the semantic `pass`/`approach`/`recede` verbs (see `Placement.ts` and [spatial-movement](../dsl/spatial-movement.md)).
- Registering/unregistering **custom** trajectories supplied as an interleaved xyz `Float32Array`.
- The **AI generation** path (`TrajectoryGen.ts`): prompt → JS code string → executed LUT → optional smoothing/ground post-processing.

All output is normalized to `[0,1]` per axis. The engine ([engine](./engine.md)) and [export](./export.md) renderer remap that unit cube into world space via the voice's `areaMin`/`areaMax`.

## Mental model

```
move <name>  →  getTrajectory(name)  →  Trajectory.evaluate(t)  →  {x,y,z} in [0,1]
                       │                        │
            ┌──────────┴──────────┐      ┌──────┴───────┐
       AnalyticalTrajectory   LUTTrajectory  (lazy-gen LUT, wrap t, lerp neighbors)
       (spiral, orbit)        (lorenz, custom)
```

One global `TRAJECTORY_REGISTRY` map holds everything. Builtins are seeded at module load; custom trajectories are added/removed at runtime by the UI and persisted in IndexedDB elsewhere (`lib/trajectoryCache.ts`). There is no per-instance state on a voice — many voices can share one `Trajectory` and just pass different `t`.

## Key types & functions

`Trajectories.ts`:

- `interface Trajectory { evaluate(t): {x,y,z} }` — the one method everything depends on. src/engine/spatial/Trajectories.ts:6
- `class AnalyticalTrajectory` — wraps a pure `(t) => {x,y,z}` fn, no storage. src/engine/spatial/Trajectories.ts:13
- `class LUTTrajectory` — lazily calls its `generate()` on first `evaluate`, caches three `Float32Array`s (`xs/ys/zs`), wraps `t` to `[0,1)`, and lerps between adjacent samples. Exported at bottom. src/engine/spatial/Trajectories.ts:21
- `spiral` — 4 revolutions/cycle in xz, sine bob in y. src/engine/spatial/Trajectories.ts:60
- `orbit` — single xz circle, fixed `y=0.5`. src/engine/spatial/Trajectories.ts:69
- `generateLorenzLUT()` — RK4 integration of the Lorenz attractor (σ=10, ρ=28, β=8/3, dt=0.005), 1000-step warmup, then `LUT_SIZE` (4096) samples min/max-normalized to `[0,1]`. src/engine/spatial/Trajectories.ts:80
- `getTrajectory(name)` — registry lookup, the main read entry. src/engine/spatial/Trajectories.ts:179
- `isTrajectoryName(name)` / `isBuiltinTrajectory(name)` — parser-facing predicates. src/engine/spatial/Trajectories.ts:183, src/engine/spatial/Trajectories.ts:187
- `registerTrajectoryFromLUT(name, points, pointCount)` — deinterleaves an `[x,y,z,...]` `Float32Array` into `xs/ys/zs`, wraps in a `LUTTrajectory`, force-evaluates `(0)` so the LUT is materialized immediately, and inserts into the registry. src/engine/spatial/Trajectories.ts:192
- `unregisterTrajectory(name)` — deletes a custom entry; refuses builtins. src/engine/spatial/Trajectories.ts:209
- `listTrajectoryNames()` — all registered names. src/engine/spatial/Trajectories.ts:215

`TrajectoryGen.ts`:

- `interface TrajectoryAIProvider` — minimal `call(...)` shape so engine code never imports the React-side `lib/aiProvider`. src/engine/spatial/TrajectoryGen.ts:7
- `TRAJECTORY_GEN_SYSTEM_PROMPT` — instructs the model to return JSON `{name, code}` where `code` is a self-contained JS body returning a `Float32Array(SIZE*3)` of normalized interleaved xyz; receives `SIZE`, `SEED`, `Math`. src/engine/spatial/TrajectoryGen.ts:15
- `interface TrajectorySpec { name; code }`. src/engine/spatial/TrajectoryGen.ts:62
- `interface TrajectoryGenParams` — `duration`, `resolution`, `smoothing`, `seed`, `ground`, `variation`. src/engine/spatial/TrajectoryGen.ts:67
- `generateTrajectoryFromPrompt(provider, userPrompt, params?)` — appends non-default params to the prompt, calls the provider (maxTokens 2048), strips markdown fences, `JSON.parse`s, and sanitizes `name` to `[a-z0-9_]`. src/engine/spatial/TrajectoryGen.ts:76
- `executeTrajectoryCode(code, size=8192, seed=0)` — runs the code via `new Function('SIZE','SEED','Math', code)` and asserts it returned a `Float32Array` of exactly `size*3`. src/engine/spatial/TrajectoryGen.ts:115
- `postProcessTrajectory(points, pointCount, smoothing, ground)` — wraparound moving-average smoothing (window = `floor(smoothing*64)`) and/or forcing `y=0` for ground-plane motion. src/engine/spatial/TrajectoryGen.ts:129

## Data flow

Read side:

- **Parser** ([parser](./parser.md)) — `SatieParser.ts:459` uses `isTrajectoryName` + `isBuiltinTrajectory` to decide whether a `move <word>` references a known custom trajectory.
- **Engine** ([engine](./engine.md)) — `SatieEngine.ts:1418` resolves `getTrajectory(name)` and calls `evaluate(t)` in the per-frame position update.
- **Export** ([export](./export.md)) — `OfflineRenderer.ts:601` does the same for offline render.
- **UI** — `TrajectoryPreview.tsx` calls `getTrajectory` to draw the path; `TrajectoriesTab.tsx` uses `listTrajectoryNames` / `isBuiltinTrajectory` / `register…` / `unregisterTrajectory` to manage the asset list.

Write/generate side (custom trajectories): UI (`Editor.tsx`, `AIPanel.tsx`) calls `generateTrajectoryFromPrompt` → `executeTrajectoryCode` → `postProcessTrajectory` → `registerTrajectoryFromLUT`. The provider passed in is the React-side AI provider adapted to `TrajectoryAIProvider`.

## Invariants & gotchas

- **Always normalized `[0,1]`.** Both builtins and generated LUTs must emit per-axis `[0,1]`; the engine alone owns world-space remapping. A trajectory that returns out-of-range values will sit at the area-cube edges.
- **`LUTTrajectory.generate()` is lazy.** The table isn't built until the first `evaluate`. `registerTrajectoryFromLUT` deliberately force-calls `evaluate(0)` so a freshly registered custom path is hot before the audio thread touches it.
- **Interleaved in, deinterleaved inside.** Custom LUTs arrive as one interleaved `[x,y,z,...]` `Float32Array` (the cache/storage format) but `LUTTrajectory` stores three separate arrays — `registerTrajectoryFromLUT` does the split.
- **Two different sizes.** Builtin `lorenz` uses `LUT_SIZE = 4096`; AI/custom trajectories default to `8192` points (the system prompt and `executeTrajectoryCode` default). `pointCount` is passed explicitly to `registerTrajectoryFromLUT`, so they coexist.
- **`t` wraps.** `LUTTrajectory.evaluate` does `t - floor(t)`, so trajectories loop; the last sample lerps back to index `0`. Analytic builtins are inherently periodic in `t`.
- **`executeTrajectoryCode` runs arbitrary JS** via the `Function` constructor — AI-generated code is executed in the page context (no sandbox). It validates only the return shape, not behavior.
- **Builtins can't be removed.** `BUILTIN_NAMES` (`spiral`/`orbit`/`lorenz`) is guarded in both `unregisterTrajectory` and `isBuiltinTrajectory`.
- **No React in engine.** `TrajectoryAIProvider` exists specifically so this engine file doesn't import the UI's provider layer.
- **In-place math, no per-tick allocation** beyond the returned `{x,y,z}` literal — consistent with the engine's GC-pressure rule.

## Change checklist

- Adding a builtin: implement the `Trajectory`, add the name to both `BUILTIN_NAMES` and `TRAJECTORY_REGISTRY`. Follow the `add-trajectory` skill: also wire `WanderType` (`Statement.ts`), the `parseMove` case (`SatieParser.ts`), and export scheduling (`OfflineRenderer.ts`).
- Changing the LUT format/size: keep the interleaved-xyz contract with `lib/trajectoryCache.ts` and `registerTrajectoryFromLUT`'s deinterleave loop in sync.
- Editing the gen prompt or params: keep `TrajectoryGenParams`, the prompt's documented parameters, and the param-stringification in `generateTrajectoryFromPrompt` aligned; verify generated code still returns `Float32Array(SIZE*3)`.
- Per the wiki rule, update this page in the same commit as any change to the two source files; run `npm run test` after engine changes.

## Sources

- src/engine/spatial/Trajectories.ts
- src/engine/spatial/TrajectoryGen.ts
