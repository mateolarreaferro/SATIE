---
title: Engine — SatieEngine.ts (Web Audio runtime)
subsystem: engine
sources:
  - src/engine/core/SatieEngine.ts
synced_sha: 1d22a687e7d4
synced: 2026-05-31
related: [parser.md, scheduler.md, dsp.md, ../ui/hooks.md]
---

# Engine — SatieEngine.ts

## Purpose

The Web Audio runtime: turns parsed `Statement[]` into live, spatially-positioned, DSP-processed voices, drives them every frame, and exposes a mutated-in-place track array the 3D viewport reads directly.

## Why it exists / responsibilities

`SatieEngine` owns everything between the parser and the speakers:

- **Transport** — `play`/`stop`/`loadScript`, master gain, brick-wall limiter.
- **Scheduling** — converts each statement's `start`/`every`/`end`/`duration` into sample-accurate callbacks on `SatieScheduler`.
- **Voice lifecycle** — create, retrigger, modulate, fade out, and tear down `TrackState` objects (gain → scaleGain → DSP → HRTF panner → master).
- **Per-frame updates** — volume/pitch/color/alpha/DSP interpolation every frame; spatial position rate-limited to 30fps.
- **Async audio resolution** — gen statements (ElevenLabs / community samples), missing-buffer callbacks, and voices queued while their buffer is still decoding.
- **Two output channels for state** — a heavyweight `EngineState` (`subscribe`) on discrete events, a throttled `EngineUIState` (`subscribeUI`) at 8fps, and a zero-allocation `getTracksArray()` for Three.js.

It has **zero React imports** by design (see `.claude/rules/engine.md`).

## Mental model

Two clocks, three consumers:

```
Statement[]  ──schedule──►  SatieScheduler (sample-accurate callbacks)
                                  │ createVoice / retriggerAudio / stopTrack
                                  ▼
                            tracks: Map<key, TrackState>
                                  │
        ┌─────────────────────────┼──────────────────────────┐
        ▼                         ▼                           ▼
  audio graph              getTracksArray()             subscribeUI (8fps)
  src→gain→scaleGain→       (mutated in place,           subscribe (discrete)
  [DSP]→HRTF panner→        read by Three.js useFrame)
  masterGain→limiter→dest
```

The `tick()` RAF loop (~60fps) does three things: drain due scheduler events, update continuous track state (spatial gated to 30fps, everything else every frame), and push a throttled UI snapshot. Three.js never waits on React — it reads the live `TrackState.position`/`color`/`alpha` that `tick` just mutated.

Voice keys are `${clip}_${statementIndex}_${countIndex}` — the index encoding is parsed back out in `isTrackAudible` (`src/engine/core/SatieEngine.ts:489`) and the phase-stagger logic.

## Key types & functions

- `TrackState` — `src/engine/core/SatieEngine.ts:36`. One voice. Holds its audio nodes, resolved `position`/`color`/`alpha`/`volume`/`pitch`, per-voice `seed`, and a block of `_`-prefixed pre-computed fields (phase offsets, `_wanderSpeed`, `_cachedDurations`) so the hot loop never recomputes or allocates.
- `EngineState` / `EngineUIState` — `src/engine/core/SatieEngine.ts:71` / `:80`. Full vs. throttled snapshot. `EngineUIState` carries `runtimeWarnings`, `mutedIndices`, `soloedIndices` as `ReadonlySet`.
- `constructor` — `src/engine/core/SatieEngine.ts:179`. Builds `AudioContext`, `SatieDSPClock`, `SatieScheduler`, master gain (0.5, -6 dB headroom), and the `DynamicsCompressorNode` limiter (threshold -2 dB, ratio 20, 0.5ms attack).
- `loadScript(script)` — `src/engine/core/SatieEngine.ts:348`. Re-parses via `parse()`; carries forward gen audio buffers by exact-then-fuzzy `genPrompt` match so a reworded script keeps its sounds. Restarts (`teardownAll` + `scheduleAll`) if playing.
- `play()` / `stop()` — `:402` / `:426`. `play` resumes the ctx, re-wires masterGain→limiter, kicks off `preGenerateAll`, then `scheduleAll` + `tick`. `stop` cancels RAF, `teardownAll`, then a hard kill: disconnect masterGain and suspend the ctx so no stray source can leak.
- `getTracksArray()` — `src/engine/core/SatieEngine.ts:234`. Returns the shared array, rebuilt only when `_tracksArrayDirty`. **This is what the viewport reads.**
- `scheduleAll()` — `:507`. For each non-muted statement × `count`, schedules a `createVoice` callback at `start.sample()`.
- `tick` — `src/engine/core/SatieEngine.ts:561`. The RAF loop. `scheduler.process()` → `updateTracks(doSpatial)` (spatial gated by `SPATIAL_INTERVAL`) → throttled `notifyUI()`.
- `createVoice(key, stmt)` — `:586`. Builds the per-voice node chain, computes `scaleGain = 1/√count`, builds the DSP chain, pre-caches all interpolation `every` durations, sets `_tracksArrayDirty`, fires the first `retriggerAudio`, and schedules the voice end (`duration` or `end`).
- `retriggerAudio(key, stmt)` — `:754`. Resolves the buffer; if absent, routes to gen / community / `onMissingBuffer` / pending-voice queue. Otherwise creates a fresh `AudioBufferSourceNode`, applies phase stagger for count-multiplied voices, micro-fades in, and re-schedules itself for `oneshot+every`.
- `stopTrack(key, fadeOut)` — `:1106`. Cancels the track's scheduler events, ramps gain to 0 (≥5ms micro-fade), schedules cleanup.
- `updateTracks(doSpatial)` — `:1144`. Per-frame: volume/pitch (× group modulation), interpolated color/alpha, DSP interpolation; spatial only when `doSpatial`.
- `calculateWanderPositionInPlace` / `calculateTrajectoryPositionInPlace` — `:1393` / `:1416`. Mutate `track.position` directly (no allocation). Wander is multi-sine noise mapped into `areaMin/areaMax`; trajectory samples a LUT via `getTrajectory()`.
- `evalModulation` / `evalFade` / `evalJump` — `:1310` / `:1323` / `:1365`. Static fade/jump curve evaluation with `LoopMode` None/Restart/Bounce.
- `toggleMute` / `toggleSolo` / `applyMixerState` — `:460` / `:473` / `:498`. Runtime mixer; rebuilds the index `Set` (new reference for React memo) and ramps each track's gain to volume-or-0.
- `setListenerPosition` / `setListenerOrientation` — `:205` / `:218`. Smoothed `AudioListener` sync (10ms time constant), with `setPosition`/`setOrientation` fallback for older browsers.
- Callbacks: `onMissingBuffer`, `onSearchCommunity`, flag `preferCommunitySamples` — `:168`–`:177`. Injected by the host (community-library resolution).

## Data flow

**Called in by** the [`useSatieEngine`](../ui/hooks.md) hook, which owns the singleton instance, calls `loadScript`/`play`/`stop`/`toggleMute`, registers `subscribe`/`subscribeUI`, and hands `getTracksArray()` to the [`SpatialViewport`](../ui/hooks.md) via a ref read in `useFrame`. The hook also wires `setListenerPosition`/`setListenerOrientation` from camera + head-tracking.

**Calls out to:**
- [`parse`, `pathFor`](./parser.md) — script text → `Statement[]`, and clip-name → canonical path.
- [`SatieScheduler`, `SatieDSPClock`](./scheduler.md) — sample-accurate event queue and `currentTime`/`secondsToSamples`/`currentSample`.
- [`buildDSPChain`, `destroyDSPChain`, the `map*` helpers](./dsp.md) — native Web Audio effect chains and 0–1 → real-range mappings.
- `Trajectories.getTrajectory` — LUT/analytical spatial paths.
- `AudioGen.generateAudio` — ElevenLabs gen (deduped via `_generationInFlight`, disabled on 401/402).

## Invariants & gotchas

- **Track state is mutated in place; never allocate in the tick loop.** `position`/`color`/`alpha` are overwritten, not replaced — the viewport holds the same object references frame-to-frame. New objects would mean GC churn and stale refs. (`.claude/rules/engine.md`.)
- **Spatial updates are rate-limited to 30fps** (`SPATIAL_HZ`, `src/engine/core/SatieEngine.ts:99`). Audio/visual interpolation runs every frame; PannerNode position is gated. Don't bypass — it's plenty for perception and saves AudioParam churn.
- **`_tracksArrayDirty` must be set on every add/remove** (`createVoice`, `stopTrack` cleanup, `teardownAll`, the `oneshot` `onended` handler). Forget it and the viewport silently shows a stale voice set.
- **Count-multiplied voices need both scaleGain (1/√N) and phase stagger.** Coherent copies of one buffer sum N× and pump the limiter; the static `scaleGain` + the ≤30ms start offset in `retriggerAudio` keep them sane. `randomstart` overrides the stagger (user intent wins).
- **Buffer resolution is racy by design.** A voice whose buffer isn't decoded yet is queued in `_pendingVoices` (keyed by both `pathFor(clip)` and raw clip name) and drained by `drainPendingVoices` when `loadAudioBuffer`/`loadAudioFile` lands. Gen requests dedupe through `_generationInFlight`; variant clips (`_2`, `_3`) reuse the base clip's buffer instead of re-generating.
- **`_activeSources` is a safety net.** `track.sourceNode` is the intended reference, but async retriggers can outlive a teardown; `teardownAll` does a second pass over `_activeSources`, and `stop()` additionally disconnects masterGain and suspends the ctx so nothing reaches the destination.
- **All gain/pitch/DSP changes use `setTargetAtTime(..., PARAM_SMOOTHING)`** (`:108`, 7ms) to avoid zipper noise; reverb only interpolates dry/wet (room IR is too expensive to regenerate), and distortion drive regenerates its curve only at the 30fps spatial rate.
- **Voice key index encoding is load-bearing.** `isTrackAudible` parses the statement index out of `key.split('_')[-2]`; renaming the key format breaks mute/solo and the stagger math.

## Change checklist

- New per-voice runtime field → add to `TrackState` (`:36`), initialize in `createVoice` (`:586`), and pre-compute it there if it's read in the hot loop.
- New interpolatable property → cache its `every` in `createVoice`'s `cacheInterpolation` block and evaluate it in `updateTracks` / `updateDSPInterpolations`.
- New DSP effect → wire it in [`DSPChain`](./dsp.md) and add its interpolation branch to `updateDSPInterpolations` (`:1218`).
- New trajectory/wander type → handle it in `calculateTrajectoryPositionInPlace` / `calculateWanderPositionInPlace`; analytical-vs-LUT speed mapping is chosen in `createVoice` via `isTrajectoryWanderType`.
- Any add/remove of a track → set `_tracksArrayDirty = true`.
- Changed the engine→UI surface (`EngineState`/`EngineUIState`) → update [`useSatieEngine`](../ui/hooks.md).
- Run `npm run test` after any engine change.

## Sources

- `src/engine/core/SatieEngine.ts`
