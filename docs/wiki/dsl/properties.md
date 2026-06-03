---
title: DSL properties reference
subsystem: dsl
sources:
  - src/engine/core/Statement.ts
  - src/engine/core/SatieParser.ts
synced_sha: 621f9fac5c7e
synced: 2026-06-03
related: [grammar.md, ../engine/statement-model.md]
---

## Purpose

Every property an author can write inside a Satie statement (`loop`/`oneshot`) block, the forms each accepts (static value, range, interpolation), and the standalone flags that take no value.

## Why it exists / responsibilities

A Satie statement is a header line (`loop clip`, `oneshot clip`, optionally `N * loop ...` and `every ...`) followed by an indented block of `key value` property lines. Properties are how an author customizes a voice: timing, gain, pitch, spatial movement, color, visuals, and per-voice DSP. The parser turns each property line into a field on a [`Statement`](../engine/statement-model.md) object; the engine reads those fields when it instantiates and ticks voices.

Two conventions hold across all properties:

- Property names are **snake_case in the DSL** (`fade_in`) but the matching `Statement` field is **camelCase** (`fadeIn`).
- Properties are **space-separated `key value`** — never `key = value`.

## Mental model

```
loop rain every 5to10        <- header: count?, kind, clip, every?
  volume 0.4to0.8            <- property block (indented)
  move walk speed 0.3
  reverb wet 0.5 size 0.7
  overlap                    <- standalone flag (no value)
```

Each indented line is matched by `PropRx` (`^[ \t]*(?<key>\w+)(?:[ \t]+(?<val>...))?`) and dispatched through the `switch (k)` in `parseSingle`. The key decides which handler runs; the value string is handed to that handler raw. Value strings can take three shapes, and which shapes a property accepts depends on its handler:

- **Static value** — `volume 0.5` → `RangeOrValue.parse` single.
- **Range** — `volume 0.2to0.9` → `RangeOrValue.parse` range; each voice samples its own value.
- **Interpolation** — `volume fade 0 1 every 4` / `... jump ...` → `InterpolationData.parse`. Only triggered when `hasModulation(v)` is true (the value contains the word `fade` or `jump`).

## Key types & functions

The authoritative property list is the `switch (k)` in `parseSingle` and the `STANDALONE_FLAGS` set beside it.

- `parseSingle(block)` — `src/engine/core/SatieParser.ts:204`. Matches the header (`StmtRx`), then loops `propRx` over the property block, dispatching each key.
- `STANDALONE_FLAGS` set — `src/engine/core/SatieParser.ts:220`: `overlap`, `persistent`, `mute`, `solo`, `randomstart`, `random_start`, `loopable`. These take no value; `v` is forced to `''`.
- `KNOWN_PROPERTIES` set — `src/engine/core/SatieParser.ts:58`. Used only for typo detection / "did you mean?" warnings, not dispatch.
- `hasModulation(v)` — `src/engine/core/SatieParser.ts:159`. Returns true if `v` matches `\bfade\b` or `\bjump\b`; gates static-vs-interpolation handling.
- `Statement` class fields — `src/engine/core/Statement.ts:96`. One field (or interpolation field) per property.

### Header (on the statement line, not the block)

| DSL | Statement field | Forms | Source |
|-----|-----------------|-------|--------|
| `N * loop`/`oneshot` | `kind`, `count` | int multiplier + literal kind | `src/engine/core/SatieParser.ts:209` |
| `every` (on header) | `every` | single `5` or range `5to10` (via `StmtRx` groups) | `src/engine/core/SatieParser.ts:213` |

### Value-bearing properties (parseSingle switch)

| DSL key(s) | Statement field | Static | Range | Interp | Source |
|------------|-----------------|:------:|:-----:|:------:|--------|
| `volume` | `volume` / `volumeInterpolation` | yes | yes | yes | `src/engine/core/SatieParser.ts:230` |
| `pitch` | `pitch` / `pitchInterpolation` | yes | yes | yes | `src/engine/core/SatieParser.ts:234` |
| `start`, `starts_at` (legacy) | `start` | yes | yes | no | `src/engine/core/SatieParser.ts:238` |
| `end` | `end` + `endFade` (`end <t> fade <d>`) | yes | yes | no | `src/engine/core/SatieParser.ts:240`, `parseEnd` :292 |
| `duration` | `duration` | yes | yes | no | `src/engine/core/SatieParser.ts:241` |
| `fade_in` | `fadeIn` | yes | yes | no | `src/engine/core/SatieParser.ts:242` |
| `fade_out` | `fadeOut` | yes | yes | no | `src/engine/core/SatieParser.ts:243` |
| `every` (in block) | `every` | yes | yes | no | `src/engine/core/SatieParser.ts:244` |
| `visual` | `visual[]` + `visualSize` | tokens `trail`/`sphere`/`cube`/`none` + `size <n>` | — | — | `parseVisual` :301 |
| `move` | `wanderType`, `areaMin/Max`, `wanderHz`, axis interps | see Move below | | | `parseMove` :325 |
| `place` | `areaMin/Max`, `hasPlacement`, `wanderType` (→Fixed if unset) | semantic words (see Place below) | — | — | `parsePlace` |
| `color` | `staticColor`, `colorR/G/B Range`, `colorR/G/B Interpolation`, `staticAlpha`, `colorAlphaInterpolation` | hex/rgb/named/per-channel | per-channel range | `fade`/`jump` color lists & per-channel | `parseColor` :694 |
| `background`, `bg` | `background` | hex / `r,g,b` / grayscale int / named | — | — | `parseBackground` :758 |
| `alpha` | `staticAlpha` / `colorAlphaInterpolation` | yes (clamped 0–1) | — | yes | `src/engine/core/SatieParser.ts:255` |
| `reverb` | `reverbParams` | per-param | per-param | per-param | `parseReverb` :852 |
| `delay` | `delayParams` | per-param | per-param | per-param | `parseDelay` :867 |
| `filter` | `filterParams` | mode + per-param | per-param | per-param | `parseFilter` :884 |
| `distortion` | `distortionParams` | mode + per-param | per-param | per-param | `parseDistortion` :906 |
| `eq` | `eqParams` | per-param (low/mid/high) | per-param | per-param | `parseEQ` :925 |
| `influence` | `genInfluence` (clamped 0–1) | yes | yes | no | `src/engine/core/SatieParser.ts:265` |

### Standalone flags (no value)

| DSL key(s) | Statement field | Source |
|------------|-----------------|--------|
| `overlap` | `overlap = true` | `src/engine/core/SatieParser.ts:245` |
| `persistent` | `persistent = true` | `src/engine/core/SatieParser.ts:246` |
| `mute` | `mute = true` | `src/engine/core/SatieParser.ts:247` |
| `solo` | `solo = true` | `src/engine/core/SatieParser.ts:248` |
| `randomstart`, `random_start` | `randomStart = true` | `src/engine/core/SatieParser.ts:249` |
| `loopable` | `genLoopable = true` | `src/engine/core/SatieParser.ts:275` |

### Move sub-grammar (`parseMove`, src/engine/core/SatieParser.ts:325)

`move` is the richest property. It writes `wanderType` (`WanderType` enum: `none`/`walk`/`fly`/`fixed`/`spiral`/`orbit`/`lorenz`/`custom`), `areaMin`/`areaMax` (`Vec3` bounds), `wanderHz`, and optional per-axis min/max `InterpolationData`. Accepted forms:

- **Semantic archetypes** `static` / `breathe` / `drift` / `swell` / `wander` / `dart` / `circle` / `pass [lr|rl]` / `approach` / `recede` — matched first, before any keyword/legacy form. Each maps via `SEMANTIC_MOTIONS` to a `wanderType` + speed + noise; `pass`/`approach`/`recede` set `WanderType.Custom` with a `line_*` trajectory name. Bounds come from a prior `place`, else the archetype's `defaultPlace`. Optional trailing `speed N` / `noise N` override the defaults. See [spatial-movement](./spatial-movement.md).
- **Keywords** `walk` / `fly` — bare (default bounds `-5to5`, walk pins `y=0`) or with axis bounds.
- **Axis form** `move x -5to5 z -10to10` — presence of axes infers walk (x+z) vs fly (any y); axis values may be ranges or interpolations (`goto`/`gobetween` recognized via `InterpolationData.parse`).
- **Builtin trajectories** `spiral` / `orbit` / `lorenz` — optional `speed`, `noise`, axis bounds.
- **Custom trajectory by name** — first word matches the trajectory registry (`isTrajectoryName` && not builtin) → `WanderType.Custom`.
- **Gen trajectory** `move gen <description> [speed] [noise] [x/y/z bounds]` → `WanderType.Custom` + `isGenTrajectory`.
- **Modifiers** anywhere: `speed <v>` (sets `wanderHz`, or `moveSpeedInterpolation` if modulated), `noise <0–1>` (`noise` field), `pos`/legacy comma syntax → `WanderType.Fixed`.

An unrecognized first word becomes a pending custom trajectory name (may be resolved later by a `gen <name>` block); a truly invalid form throws `SatieSyntaxError`.

### Place sub-grammar (`parsePlace`)

`place <sector> <depth> [height] [extent]` — semantic position. Tokens are order-independent;
each is matched against the `SECTORS` / `DEPTHS` / `HEIGHTS` / `EXTENTS` sets and unknown tokens warn.
The four resolve through `resolvePlacement()` into an `areaMin`/`areaMax` box and set `hasPlacement = true`;
if no `move` has run yet, `wanderType` becomes `Fixed`. Because `place` always owns the region and a
semantic `move` only fills bounds when `hasPlacement` is false, the two compose **order-independently**
(`place` wins the region, `move` wins the motion). The `hasPlacement` flag lives on `Statement`. Defaults:
sector `ahead`, depth `mid`, height `level`, extent `narrow`. See [spatial-movement](./spatial-movement.md).

## Data flow

- **Called in by** `parse` / `parseWithWarnings` / `tryParse` (`src/engine/core/SatieParser.ts:1477`, `:1469`, `:1685`). `parse` runs five pre-passes (comment strip, `and`-expansion, variable substitution, multi-clip expansion, gen-block extraction) before slicing each statement's header + indented block and calling `parseSingle`. See the [grammar](./grammar.md) page for the pre-pass pipeline.
- **Group inheritance** — `flushGroup` (`src/engine/core/SatieParser.ts:941`) re-runs the same property handlers for `group`-level defaults, applying them only where the child statement left a field unset (volume/pitch multiply; color/move/visual/DSP fill defaults).
- **Gen blocks** — `extractGenBlocks` (`:1280`) and `extractTrajectoryGenBlocks` (`:1371`) parse a *separate* property vocabulary (`prompt`, `duration`, `influence`, `loopable` for audio; plus `resolution`/`smoothing`/`seed`/`ground`/`variation` for trajectories) into `GenDefinition` / `TrajectoryGenDefinition`, not into `Statement` directly.
- **Calls out to** `RangeOrValue.parse` (static/range) and `InterpolationData.parse` (modulation) for every value-bearing property.
- **Consumed by** the engine when it builds tracks; the [statement model](../engine/statement-model.md) describes how each field is read at voice-creation and tick time.

## Invariants & gotchas

- **`hasModulation` is the only interpolation gate** for the simple scalar properties (`volume`, `pitch`, `alpha`, color channels). A value only becomes an `InterpolationData` if it literally contains `fade` or `jump`; otherwise it's a `RangeOrValue`. So `volume 0to1` is a per-voice random range, while `volume fade 0 1 every 4` is a time curve.
- **`duration` means two different things.** On a normal statement it's playback length. On a `gen` (inline or block) statement, `promoteGenDuration` (`src/engine/core/SatieParser.ts:1672`) moves `duration` into `genDuration` (generation length, clamped 0.5–22s) and nulls out `duration`.
- **Standalone flags ignore any trailing text.** `STANDALONE_FLAGS` forces `v=''`, so `mute true` and `mute` are identical; an extra token is silently dropped.
- **`loopable` is overloaded.** In a statement block it sets `genLoopable`; in a `gen` block it's also a flag. It is a standalone flag in `parseSingle` but NOT in the group-level `STANDALONE_FLAGS` set (`:1618`) — groups can't inherit `loopable`.
- **Group `STANDALONE_FLAGS` is a smaller set** (`:1618`): `overlap`, `persistent`, `mute`, `solo`, `randomstart`, `random_start` — no `loopable`. Keep the two flag sets in mind when adding a flag.
- **Unknown keys warn, don't fail.** A key not in `KNOWN_PROPERTIES` produces a "did you mean?" warning via `suggestProperty` (Levenshtein ≤ 2) and is otherwise ignored — `KNOWN_PROPERTIES` (`:58`) must be kept in sync with the switch or valid properties get spurious warnings.
- **Color values auto-normalize 0–255 → 0–1** in `parseColorChannel` (`:798`) when any value exceeds 1; alpha is never normalized (already 0–1).
- **DSP params have silent defaults** (e.g. reverb wet 0.33, filter cutoff 0.5). Omitting a sub-param doesn't disable it — it uses the default in `parseReverb`/`parseFilter`/etc.
- **Prefer `place` over raw xyz bounds** for AI-generated scripts (the house style of not putting xyz on `walk`/`fly` — see project memory `feedback_satie_script_style` — is now served by `place`, which gives directionality without coordinates). The parser still accepts explicit bounds for fine control.
- **`place` and a semantic `move` are order-independent** thanks to the `hasPlacement` flag: writing `move` before `place` still lets `place` own the region. The same flag gates group inheritance (`place` cascades only if the child has none).

## Change checklist

When adding or changing a property (mirrors the `add-property` skill and CLAUDE.md "Adding a new Satie property"):

1. Add the field to the `Statement` class — `src/engine/core/Statement.ts:96` (camelCase).
2. Add the `case` to the `switch (k)` in `parseSingle` — `src/engine/core/SatieParser.ts:229`. If it's a no-value flag, add the snake_case key to `STANDALONE_FLAGS` (`:220`) AND, if groups should inherit it, the group flag set (`:1618`).
3. Add the snake_case name to `KNOWN_PROPERTIES` (`:58`) so it doesn't trigger typo warnings, and to `PROPERTY_KEYWORDS` (`:1050`) if it should act as an `and`-separator boundary, and to `RESERVED_WORDS` (`:1102`) if it must not be usable as a variable name.
4. Wire group inheritance in `flushGroup` (`:1009`) if the property should cascade.
5. Add parser tests in `SatieParser.test.ts`.
6. Handle the field in `SatieEngine.ts` (track creation or per-frame tick).
7. Update the editor (`SatieEditor.tsx` tokenizer + `PROPERTY_DOCS` + completion) and `DocsPanel.tsx`.
8. Update this wiki page and [grammar.md](./grammar.md) in the same commit (wiki commit gate).

## Sources

- `src/engine/core/Statement.ts`
- `src/engine/core/SatieParser.ts`
