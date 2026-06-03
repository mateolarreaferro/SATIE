---
title: Statement model — Statement, RangeOrValue, Interpolation, Easing
subsystem: engine
sources:
  - src/engine/core/Statement.ts
  - src/engine/core/RangeOrValue.ts
  - src/engine/core/InterpolationData.ts
  - src/engine/core/EaseFunctions.ts
synced_sha: 0c268827c6fa
synced: 2026-06-03
related: [parser.md, engine.md, ../dsl/properties.md]
---

# Statement model

## Purpose

The plain-data IR the parser emits and the engine consumes: one `Statement` per sound event, with every value being a `RangeOrValue` (a number, a min/max range, or null) optionally driven by an `InterpolationData` modulation curve, eased by an `EaseFunction`.

## Why it exists / responsibilities

These four files are the contract between [parser](./parser.md) (writes them) and [engine](./engine.md) (reads them). They carry **no behavior** beyond parsing strings and sampling/easing math — no Web Audio, no React. Their job:

- `Statement` — flat bag of every property a voice can have (playback, spatial, color, DSP). Ported from the Unity `Statement` class.
- `RangeOrValue` — lets any numeric property be a fixed value *or* a random range, with one `sample()` call to resolve it. Satisfies the engine rule that all DSP params support ranges.
- `InterpolationData` — describes a time-varying property (`fade`/`jump` ... `every` ... `loop`). Stored on `*Interpolation` fields of `Statement`.
- `EaseFunctions` — the easing-curve library and a name→function lookup used when applying interpolation.

## Mental model

```
DSL text ──parser──► Statement {
                       volume: RangeOrValue(0.2to0.8)   ← sample() at spawn → 0.55
                       volumeInterpolation: InterpolationData(fade 0 1 every 2 loop bounce)
                       wanderType, areaMin/Max, reverbParams, ... }
                                         │
                                  engine reads
                                         ▼
            per-voice: ease(t) over InterpolationData.values, every `every` seconds
```

A `Statement` is a snapshot template, not a live voice. Ranges are resolved by `sample()` (usually once, at spawn); interpolation fields are walked over time by the engine.

## Key types & functions

### Statement (`src/engine/core/Statement.ts:96`)
A mutable class with defaults inline. Notable fields:

- Playback: `kind`, `clip`, `count`, `start`/`end`/`duration`/`every`, `volume`, `pitch`, `fadeIn`/`fadeOut` — all `RangeOrValue` (`Statement.ts:97`–`118`). Flags: `overlap`, `persistent`, `mute`, `solo`, `randomStart`, `isGenerated`.
- Generation: `genPrompt`, `genDuration`, `genInfluence`, `genLoopable` (`Statement.ts:112`).
- Spatial: `wanderType: WanderType` (`Statement.ts:121`), `areaMin`/`areaMax: Vec3`, `wanderHz` (default `single(0.5)`), `hasPlacement` (set by `place`/`move` axes; lets the semantic `place` own the region while `move` owns the motion — see [spatial-movement](../dsl/spatial-movement.md)), `noise`, and the `genTrajectory*` LUT fields (`Statement.ts:127`–`134`).
- Visual: `visual: string[]`, `visualSize` (`Statement.ts:138`).
- Color: `staticColor`/`staticAlpha`, `colorRed/Green/BlueRange`, plus per-channel `*Interpolation` (`Statement.ts:159`–`167`).
- Modulation fields (all `InterpolationData | null`): `volumeInterpolation`, `pitchInterpolation`, group-level `groupVolume/PitchModulation`, and the six `moveX/Y/ZMin/MaxInterpolation` + `moveSpeedInterpolation` (`Statement.ts:145`–`156`).
- DSP: `reverbParams`/`delayParams`/`filterParams`/`distortionParams`/`eqParams`, each its own interface (`Statement.ts:50`–`94`, `170`–`174`). Each DSP param interface pairs a `RangeOrValue` value with a matching `…Interpolation` field.
- `background: string | null` — viewport bg color (global, set via `background` property).
- `clone()` (`Statement.ts:176`) — `Object.assign` shallow copy, then deep-copies `visual`, `areaMin`, `areaMax`. Used by group/multi-clip expansion in the parser.

### WanderType (`src/engine/core/Statement.ts:27`)
Enum: `None`, `Walk`, `Fly`, `Fixed`, `Spiral`, `Orbit`, `Lorenz`, `Custom`. `isTrajectoryWanderType()` (`Statement.ts:40`) returns true for the builtin LUT types (`Spiral`/`Orbit`/`Lorenz`) and `Custom`, but **not** `Walk`/`Fly`.

### GenDefinition / TrajectoryGenDefinition (`Statement.ts:8`, `16`)
Config records for audio-gen and trajectory-gen blocks, separate from the playback statement.

### RangeOrValue (`src/engine/core/RangeOrValue.ts:6`)
Immutable class; private constructor. State is `min`, `max`, `isRange`, `isNull`.

- Singletons: `Null` (isNull), `Zero`, `One` (`RangeOrValue.ts:19`–`21`).
- `single(v)` / `range(min,max)` factories (`RangeOrValue.ts:23`,`27`).
- `parse(str)` (`RangeOrValue.ts:34`) — `"0.5"` → single, `"0.2to0.8"` → range (splits on first `"to"`), empty/NaN → `Null`.
- `sample(rng?)` (`RangeOrValue.ts:58`) — null→`0`, single→`min`, range→`min + r*(max-min)` using `rng()` or `Math.random()`.
- `mul(k)` (`RangeOrValue.ts:66`) — scalar multiply, preserves range-ness; null stays null.

### InterpolationData (`src/engine/core/InterpolationData.ts:25`)
Holds `values: number[]`, `every: RangeOrValue`, `modulationType: ModulationType`, `loopMode: LoopMode`.

- `ModulationType` (`InterpolationData.ts:10`): `Fade` (continuous) or `Jump` (discrete step). `InterpolationType` is a legacy alias for it (`InterpolationData.ts:22`).
- `LoopMode` (`InterpolationData.ts:15`): `None`, `Bounce`, `Restart`.
- Getters: `minValue` = `values[0]`, `maxValue` = last value, `durationRange` = `every` (engine-caching alias) (`InterpolationData.ts:44`–`50`).
- `parse(str)` (`InterpolationData.ts:60`) — matches `fade <values...> every <dur> [loop bounce|restart]` or the `jump` variant. Requires ≥2 values and a non-null `every`, else returns `null`.

### EaseFunctions (`src/engine/core/EaseFunctions.ts`)
- `EaseFunction = (t: number) => number` (`EaseFunctions.ts:6`); `linear` is the identity.
- Full Penner-style set: sine/quad/cubic/quart/quint/expo/circ/back/elastic/bounce in `in`/`out`/`inout` variants, plus the looping helpers `sine`, `sineReturn`, `cosineReturn`, `elasticReturn`, `bounceReturn` (`EaseFunctions.ts:109`–`117`).
- `getEaseFunction(name)` (`EaseFunctions.ts:158`) — case-insensitive lookup in `easeFunctionMap`; unknown/empty name falls back to `linear`. The map registers both bare (`inquad`) and `ease`-prefixed (`easeinquad`) aliases.

## Data flow

- **In:** [parser](./parser.md) constructs and mutates `Statement` objects (one per event), calling `RangeOrValue.parse` and `InterpolationData.parse` to fill numeric and modulation fields, and expands groups/multi-clips via `Statement.clone()`.
- **Out:** [engine](./engine.md) reads a `Statement` to spawn a track: calls `RangeOrValue.sample()` to fix concrete values at spawn time, walks each non-null `*Interpolation` over time, and uses `getEaseFunction` to shape `fade` curves. See [properties](../dsl/properties.md) for the DSL surface that maps to these fields.

## Invariants & gotchas

- **Header comments lie about names.** `InterpolationData.ts:5` mentions `goto/gobetween/interpolate`, and `Statement.ts:3` references the Unity port. The *actual* modulation grammar is `fade`/`jump` (see `parse`). Trust the code, not the doc comments.
- **`RangeOrValue.Null` vs `Zero`.** Both have `min=max=0`; the difference is `isNull`. `Null` means "unset" (`sample()` still returns 0). Many `Statement` defaults are `Null`, not `Zero` (e.g. `end`, `duration`, `every`) — the engine treats null as "no value supplied," not "zero."
- **`RangeOrValue` is immutable; `Statement` is not.** Mutate `Statement` fields freely (parser does), but never reach into a `RangeOrValue`'s fields — use the factories / `mul`.
- **`clone()` is shallow except three fields.** Only `visual`, `areaMin`, `areaMax` are deep-copied (`Statement.ts:179`–`181`). `RangeOrValue`/`InterpolationData` fields are shared by reference after clone — safe because both are effectively immutable, but don't start mutating them in place.
- **`InterpolationData.parse` needs ≥2 values** and a parseable `every`; otherwise it silently returns `null`, leaving the property static.
- **`parse` splits on the first `"to"`** — a token like `"5to14"` parses as a range; there's no validation that min ≤ max.
- **Easing fallback is silent.** A misspelled curve name resolves to `linear` with no error.
- Engine rules (`.claude/rules/engine.md`): every DSP param must support `RangeOrValue`, and new musically-meaningful properties should support `InterpolationData`.

## Change checklist

When you add a property to this model:

1. Add the field (with a sensible `RangeOrValue`/null default) to `Statement` (`Statement.ts:96`).
2. If it has a sub-param group (DSP-style), add the `*Params` interface with paired `…Interpolation` fields.
3. If it deep-copies (arrays/objects), extend `Statement.clone()` (`Statement.ts:176`).
4. Wire parsing in [parser](./parser.md) (`parseSingle` switch) and consumption in [engine](./engine.md).
5. Document the DSL surface in [properties](../dsl/properties.md), and add editor highlighting/docs (`SatieEditor.tsx`).
6. New easing curve → add the `EaseFunction` and register its aliases in `easeFunctionMap` (`EaseFunctions.ts:119`).
7. New modulation grammar → extend `InterpolationData.parse` and `ModulationType`.
8. Run `npm run test`.

## Sources

- `src/engine/core/Statement.ts`
- `src/engine/core/RangeOrValue.ts`
- `src/engine/core/InterpolationData.ts`
- `src/engine/core/EaseFunctions.ts`
