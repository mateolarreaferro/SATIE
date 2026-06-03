---
title: DSL spatial movement
subsystem: dsl
sources:
  - src/engine/spatial/Trajectories.ts
  - src/engine/spatial/Placement.ts
synced_sha: b1dd631e738b
synced: 2026-06-03
related: [grammar.md, properties.md, ../engine/spatial.md, ../lib/ai-pipeline.md]
---

## Purpose

Two layers of spatial vocabulary. `Placement.ts` is the **semantic** layer: it maps
human/AI-friendly words (`place ahead far low wide`, `move drift`) onto the engine's
coordinate + motion fields, so authors and the AI reason about *where a sound sits and
how it moves* without doing arithmetic. `Trajectories.ts` is the **named-pattern** layer:
it turns movement keywords (`spiral`/`orbit`/`lorenz`/`line_*`/custom) into a normalized
`(x, y, z)` position the engine remaps into 3D space.

## Why it exists / responsibilities

A moving voice in a Satie script needs a position at every frame. `Trajectories.ts` is the registry + evaluator for the *named* movement patterns. Each registered trajectory implements one method, `evaluate(t)`, returning a point in `[0,1]³`; the engine then remaps that unit-cube point into the voice's `areaMin`/`areaMax` bounds. The module owns:

- Two evaluation strategies: **analytical** (compute from `t` directly, no memory) and **LUT** (pre-compute a Float32Array path once, lerp at runtime).
- The builtins: `spiral`, `orbit`, `lorenz`, and the four linear traverses `line_lr` /
  `line_rl` / `line_toward` / `line_away` (produced by the semantic `pass`/`approach`/`recede` verbs).
- A name → `Trajectory` registry, plus register/unregister/list helpers used to inject AI-generated custom trajectories at runtime.

Note: `walk`, `fly`, `gen`, and `pos` are *not* in this file. They are movement modes resolved entirely in the parser/engine. This module only covers the **named pattern** trajectories (the analytical/LUT ones) and the custom-LUT path.

### Semantic placement & motion vocabulary (`Placement.ts`)

The frame is **listener at the origin, +Z = ahead/forward, +X = right, +Y = up**, with
everything kept inside ~8 m. Authors place a sound with two orthogonal directives:

- **`place <sector> <depth> [height] [extent]`** — *where* it sits. `resolvePlacement()`
  is a pure function mapping the words to an `areaMin`/`areaMax` box, deterministically
  (same words → same region). sector ∈ {ahead, behind, left, right, the four diagonals,
  surround, overhead}; depth ∈ {near ≈1.5 m, mid ≈3.5 m, far ≈6 m}; height ∈ {low, level,
  high}; extent ∈ {narrow, wide, surround}.
- **`move <archetype>`** — *how* it moves. `SEMANTIC_MOTIONS` maps each verb to a
  `wanderType` + speed + noise: `static`→Fixed, `breathe`/`drift`/`swell`→slow Fly,
  `wander`→Walk, `dart`→fast noisy Fly, `circle`→Orbit, `pass`/`approach`/`recede`→a
  `line_*` Custom trajectory.

`place` always owns the region and `move` always owns the motion, **order-independently**:
`place` sets `areaMin`/`areaMax` and the `hasPlacement` flag; a semantic `move` only fills
in bounds when no `place` has run (using the archetype's `defaultPlace`). So whichever is
written first, `place` wins the region and `move` wins the trajectory.

The point of this layer is *coherence*: because regions come from one shared mapping, two
elements told to sit "ahead far" land on the same bearing — the fix for soundscapes where
the ocean used to fly around and the ship sat on a different heading than the sea. The
archetype taxonomy (enveloping bed / directional bed / landmark / mobile agent / transient
accent) lives in the AI system prompt and scene-plan stage; see [ai-pipeline](../lib/ai-pipeline.md).

## Mental model

Author writes a movement keyword. The parser maps it to a `WanderType`; for the named patterns the engine looks the name up here and calls `evaluate(t)`, where `t` is a phase that increases over time. Output is always the unit cube; the engine scales it.

```
script "spiral"  ──parser──▶ WanderType.Spiral
                              │
engine tick (t grows) ──────▶ getTrajectory("spiral").evaluate(t) ──▶ {x,y,z} in [0,1]³
                                                                        │
                                                       remap to areaMin..areaMax (engine)
```

`t` is treated as a phase: LUT trajectories wrap it to `[0,1)` (`Trajectories.ts:42`), so the path loops. Analytical ones use `t` directly inside trig.

## Key types & functions

- `interface Trajectory { evaluate(t): {x,y,z} }` — the one-method contract every pattern implements. src/engine/spatial/Trajectories.ts:6
- `AnalyticalTrajectory` — wraps a pure `t → {x,y,z}` function, no storage. Used by `spiral` and `orbit`. src/engine/spatial/Trajectories.ts:13
- `LUTTrajectory` — lazily generates three `Float32Array`s on first `evaluate`, then index-lerps and wraps `t` to `[0,1)`. Exported so the trajectory-preview/cache code can build them. src/engine/spatial/Trajectories.ts:21
- `spiral` — analytical: 4 revolutions per cycle in the X/Z plane (`angle = 2π·t·4`) with a slow sine bob on Y. src/engine/spatial/Trajectories.ts:60
- `orbit` — analytical: one X/Z circle per cycle at fixed `y = 0.5` (flat horizontal ring). src/engine/spatial/Trajectories.ts:69
- `generateLorenzLUT()` — RK4-integrates the Lorenz system (σ=10, ρ=28, β=8/3, dt=0.005), warms up 1000 steps to skip the transient, fills a `LUT_SIZE` (4096) path, then min/max-normalizes each axis to `[0,1]`. src/engine/spatial/Trajectories.ts:80
- `lorenz` — the `LUTTrajectory` built from `generateLorenzLUT`. src/engine/spatial/Trajectories.ts:167
- `line_lr` / `line_rl` / `line_toward` / `line_away` — analytical linear traverses across the placed region (left→right, right→left, far→near, near→far), one-way with wrap. Registered as builtins; emitted only by the semantic `pass`/`approach`/`recede` verbs. src/engine/spatial/Trajectories.ts
- `resolvePlacement(sector, depth, height?, extent?)` — pure word→`{min,max}` box mapping; the deterministic core of `place`. src/engine/spatial/Placement.ts
- `SEMANTIC_MOTIONS` — verb → `{wanderType, hz, noise, customName?, defaultPlace}` table backing semantic `move`. `isSemanticMotion()` / `defaultRegionFor()` are its helpers. src/engine/spatial/Placement.ts
- `getTrajectory(name)` — registry lookup, `undefined` if absent. src/engine/spatial/Trajectories.ts:179
- `isTrajectoryName(name)` — is this name registered (builtin or custom)? src/engine/spatial/Trajectories.ts:183
- `isBuiltinTrajectory(name)` — is it one of `spiral`/`orbit`/`lorenz`? src/engine/spatial/Trajectories.ts:187
- `registerTrajectoryFromLUT(name, points, pointCount)` — de-interleaves an `xyz` Float32Array into three arrays, wraps them in a `LUTTrajectory`, force-evaluates once so the LUT is ready, and registers it. src/engine/spatial/Trajectories.ts:192
- `unregisterTrajectory(name)` — removes a custom trajectory; refuses builtins. src/engine/spatial/Trajectories.ts:209
- `listTrajectoryNames()` — all registered names. src/engine/spatial/Trajectories.ts:215

## Author-facing movement modes

From the script-writer's POV (resolved in the parser, not all here):

- **Semantic (preferred):** `place <sector> <depth> [height] [extent]` for position, and
  `move <archetype>` (`static`/`breathe`/`drift`/`swell`/`wander`/`dart`/`circle`/`pass`/`approach`/`recede`)
  for motion. These desugar to the fields below — see the `Placement.ts` section above.
- `walk` / `fly` — random-wander modes (parser maps to `WanderType.Walk` / `WanderType.Fly`); positions are engine-driven, *not* named trajectories. Bounds are optional (`move fly x -5to5 y 0to3 z -5to5`) and now allowed — `place` is the higher-level way to set them.
- `spiral` / `orbit` / `lorenz` — the builtin named patterns defined in this file.
- `gen` — an AI-generated trajectory; the generated path is registered here via `registerTrajectoryFromLUT` under a custom name and evaluated as a `WanderType.Custom` LUT.
- Any other registered name (a custom/AI trajectory) — parsed to `WanderType.Custom`, looked up by name.

**Visual convention:** moving voices (any motion archetype or walk/fly/spiral/orbit/lorenz/gen/custom) always get `visual trail`; still voices (`move static` or `place` with no move) always get `visual sphere`. This is enforced in the AI system prompt, not in this file — but it is the rule a movement page must state.

## Data flow

- **In:** `src/engine/core/SatieParser.ts` calls `isTrajectoryName` / `isBuiltinTrajectory` to classify a movement word into a `WanderType` (see [parser](../engine/parser.md)). The engine (`SatieEngine.ts`) calls `getTrajectory(name).evaluate(t)` each tick for trajectory voices and remaps the result into the voice's area bounds (see [engine](../engine/engine.md) and [spatial](../engine/spatial.md)).
- **Custom registration:** `Editor.tsx` and `TrajectoriesTab.tsx` call `registerTrajectoryFromLUT` to inject cached / AI-generated LUTs; `TrajectoryPreview.tsx` calls `getTrajectory` to draw a preview. The LUT format is the interleaved xyz `Float32Array` described in [statement model](../engine/statement-model.md).
- **Out:** nothing — this module returns plain `{x,y,z}` objects and never touches Web Audio, React, or storage.

## Invariants & gotchas

- **Output is always normalized `[0,1]³`.** Never return world coordinates here; the engine owns area remapping. The Lorenz path is explicitly min/max-normalized for this reason (`Trajectories.ts:154`–`162`).
- **`t` is a phase, not seconds.** LUT trajectories wrap with `t - Math.floor(t)` so paths loop seamlessly; analytical ones must stay smooth/periodic in `t`.
- **LUTs are lazy and one-shot.** `LUTTrajectory.evaluate` generates on first call only; `registerTrajectoryFromLUT` force-calls `evaluate(0)` so the data exists before the first frame (`Trajectories.ts:204`).
- **Builtins are immutable.** `unregisterTrajectory` returns `false` for `spiral`/`orbit`/`lorenz` (the `BUILTIN_NAMES` set, `Trajectories.ts:171`). The registry is module-global mutable state — registering a custom name twice overwrites the prior entry.
- **Index wrap at the LUT tail** links the last point back to index `0` (`Trajectories.ts:45`), so a custom LUT should be authored as a closed loop or it will snap.
- The `WanderType` enum and `isTrajectoryWanderType` helper live in `Statement.ts`, not here — keep the two registries (`BUILTIN_NAMES` here, `BUILTIN_TRAJECTORY_TYPES` there) in agreement.

## Change checklist

When adding a builtin trajectory type, the full path spans several files (see the `add-trajectory` skill):

1. Add the `WanderType` enum value in `Statement.ts`.
2. Add the `Trajectory` impl here (analytical or LUT) and register it in `TRAJECTORY_REGISTRY` + `BUILTIN_NAMES`.
3. Add the parser case in `parseMove()` in `SatieParser.ts`.
4. The engine evaluates generically via `getTrajectory(...).evaluate(t)` — no change needed there for a new builtin.
5. Add wander scheduling in `OfflineRenderer.ts` so export matches live playback.
6. Update this page and [spatial](../engine/spatial.md) in the same commit (wiki commit gate).

Changing normalization, `LUT_SIZE`, or the `evaluate` lerp/wrap behavior affects every voice — re-check that paths still loop and stay inside the unit cube, then `npm run test`.

## Sources

- src/engine/spatial/Trajectories.ts
- src/engine/spatial/Placement.ts
