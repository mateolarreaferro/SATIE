---
title: Engine — subsystem overview
subsystem: engine
sources:
  - src/engine/index.ts
synced_sha: db20bb6ea5da
synced: 2026-05-31
related: [parser.md, engine.md, dsp.md, spatial.md, export.md, scheduler.md, statement-model.md, audio-gen.md]
---

## Purpose

The standalone, zero-React Web Audio runtime that turns a `.satie` script into scheduled, spatialized, DSP-processed sound.

## Why it exists / responsibilities

`src/engine/` is the audio core, deliberately isolated from the UI. Its job:

- Parse plaintext `.satie` scripts into structured `Statement[]` (the [parser](./parser.md)).
- Run the Web Audio graph: spawn voices, build per-voice effect chains, schedule events ahead of the audio clock, and update spatial position each frame (the [engine](./engine.md)).
- Provide a public API surface (re-exported from `index.ts`) so the UI — and the offline [export](./export.md) path — can drive it without reaching into internal modules.

The hard boundary: **no React, no UI library is ever imported into `src/engine/`** (see `.claude/rules/engine.md`). The engine is consumable from a plain script, a test, or the React app equally.

## Mental model

Think of the engine as a pipeline with a clean public seam at `index.ts`:

```
.satie text
   │  parse() / tryParse()      → parser
   ▼
Statement[]                     → statement-model
   │  SatieEngine.load()
   ▼
tracks + per-voice DSP chain    → engine + dsp
   │  SatieScheduler (sorted array, ahead of DSPClock)
   ▼
Web Audio graph → speakers      → spatial (HRTF panner)
```

The UI sits *outside* this box. It calls in through the exported `SatieEngine` and reads back live state — see Data flow.

## Key types & functions

`index.ts` is purely a barrel of re-exports; it defines no logic itself. The public surface it exposes:

- `SatieEngine` (class) — the runtime — src/engine/index.ts:1; documented in [engine](./engine.md).
- `EngineState`, `EngineUIState`, `TrackState` (types) — runtime + UI snapshot shapes — src/engine/index.ts:2.
- `parse`, `parseWithWarnings`, `tryParse`, `pathFor`, `sanitizeForClipName`, `SatieSyntaxError` — parser entry points + helpers — src/engine/index.ts:3; documented in [parser](./parser.md).
- `ParseWarning`, `ParseResult` (types) — parser output — src/engine/index.ts:4.
- `Statement`, `WanderType` — the parsed statement data class + trajectory enum — src/engine/index.ts:5; documented in [statement-model](./statement-model.md).
- `Vec3`, `ReverbParams`, `DelayParams`, `FilterParams`, `DistortionParams`, `EQParams` (types) — DSP param shapes — src/engine/index.ts:6; documented in [dsp](./dsp.md).
- `RangeOrValue` — single value or min/max range with sampling — src/engine/index.ts:7.
- `InterpolationData`, `ModulationType`, `LoopMode` — goto/gobetween/interpolate config — src/engine/index.ts:8.
- `SatieDSPClock` — `AudioContext.currentTime`-based clock — src/engine/index.ts:9.
- `SatieScheduler`, `SatieAudioEvent` — sorted-array scheduler + event type — src/engine/index.ts:10, src/engine/index.ts:11; documented in [scheduler](./scheduler.md).

Note: the AI [audio-gen](./audio-gen.md) module (`src/engine/audio/AudioGen.ts`) lives under the engine tree but is **not** re-exported from `index.ts`.

## Data flow

**Callers in (UI → engine):** the UI never imports engine internals directly; it imports from the barrel `../../engine`. The bridge is the `useSatieEngine` hook ([hooks](../ui/hooks.md)), which:

- constructs a `SatieEngine` and holds it in a ref,
- exposes `uiState` (an `EngineUIState`, updated at low fps for React rendering),
- exposes `tracksRef` — a ref pointing at the engine's live tracks array via `engine.getTracksArray()` (src/ui/hooks/useSatieEngine.ts:50). Three.js reads `tracksRef` directly inside `useFrame()`, bypassing React entirely.

**Calls out (engine internals):** `SatieEngine` consumes the [parser](./parser.md) output (`Statement[]`), builds native Web Audio node chains via [dsp](./dsp.md), drives spatial movement via [spatial](./spatial.md) (`Trajectories.evaluate`), and orders playback through the [scheduler](./scheduler.md) against [`SatieDSPClock`](./scheduler.md). The offline [export](./export.md) path re-implements playback against an `OfflineAudioContext`.

**Audio signal chain (per voice):**

```
Source → Gain → Filter → Distortion → Delay → Reverb → EQ → Panner(HRTF) → Master Gain → Limiter → Destination
```

Effects are native nodes with dry/wet crossfade gains; the master `Limiter` is a `DynamicsCompressorNode` guarding against clipping when many voices overlap. Detail in [dsp](./dsp.md) and [engine](./engine.md).

## Invariants & gotchas

- **Zero-React boundary is absolute.** Importing any UI/React symbol into `src/engine/` is forbidden (`.claude/rules/engine.md`). The only sanctioned channel back to the UI is the typed export surface in `index.ts`.
- **`index.ts` is a barrel only.** Add new public types/functions here when you want the UI to see them; do not add logic. New internal modules that the UI shouldn't touch (e.g. `audio/AudioGen.ts`) stay unexported.
- **`tracksRef` is the engine's live array, not a copy.** The UI mutates nothing; Three.js reads it each frame. Never insert React state between engine and viewport (CLAUDE.md performance rule).
- **Track state is mutated in place** in the tick loop to avoid GC pressure; don't allocate new objects per frame (`.claude/rules/engine.md`).
- **Panner position updates are rate-limited to 30fps** — don't bypass.
- **All DSP params must accept `RangeOrValue`** (static value AND range), and support `InterpolationData` where musically sensible (`.claude/rules/engine.md`).
- Two parser entry points exist for different callers: `parse` throws `SatieSyntaxError`; `tryParse` returns a `ParseResult` (used by `verifyAndRepair` in the AI pipeline). See [parser](./parser.md).

## Change checklist

- Exposing a new engine capability to the UI → add the export to `src/engine/index.ts` and update this page's "Key types & functions".
- Adding a public type → re-export it here and link the page that documents it.
- Run `npm run test` after any engine change (`.claude/rules/engine.md`).
- Keep the relevant neighbor wiki page (parser/engine/dsp/spatial/export/scheduler/statement-model/audio-gen) in sync in the same commit (`.claude/rules/wiki.md`).

## Sources

- src/engine/index.ts
