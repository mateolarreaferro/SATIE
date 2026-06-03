---
title: DSL DSP effects
subsystem: dsl
sources:
  - src/engine/dsp/DSPChain.ts
synced_sha: 83bf4e7fcb78
synced: 2026-05-31
related: [grammar.md, ../engine/dsp.md]
---

# DSL DSP effects

## Purpose

The author-facing effect properties (`filter`, `distortion`, `delay`, `reverb`, `eq`) and how their normalized 0–1 parameters map to real audio.

## Why it exists / responsibilities

`DSPChain.ts` builds the per-voice effect chain out of native Web Audio nodes — no AudioWorklets, so all sample processing stays on the audio thread with zero JS-per-sample overhead. Its two jobs:

1. **Normalization** — the Satie DSL exposes almost every effect parameter on a 0–1 scale. This module maps those normalized values to the real audio ranges the underlying nodes expect (Hz, Q, dB, drive amount).
2. **Chain construction** — assemble only the effects an author actually wrote, in a fixed processing order, with a dry/wet crossfade per effect.

Each effect parameter is a `RangeOrValue` in `Statement.ts`, so an author may write a static value, a `min..max` range (sampled at spawn via `.sample()`), or attach an `InterpolationData` block to animate it over time. This module reads the sampled value at build time and exposes node refs so the engine can re-drive parameters during interpolation.

## Mental model

One voice's source feeds a series of optional effect blocks. Each block is an internal dry/wet split:

```
            ┌── dry ──────────────┐
input ──────┤                     ├── output
            └── <effect node> ─ wet┘
```

Active effects are wired output→input in this fixed order, regardless of the order properties appear in the script:

```
source → [filter] → [distortion] → [delay] → [reverb] → [EQ] → output
```

If no effect properties are present, `buildDSPChain` returns `null` and the voice connects straight to its panner (see [engine dsp](../engine/dsp.md)).

## Key types & functions

**Normalization maps (0–1 → real units), all clamp to [0,1] first:**

- `mapCutoff(n)` — 20 Hz–20 kHz, exponential (`20 * 1000^n`). [src/engine/dsp/DSPChain.ts:44](../../../src/engine/dsp/DSPChain.ts#L44)
- `mapResonance(n)` — Q 0.1–20, exponential. [src/engine/dsp/DSPChain.ts:50](../../../src/engine/dsp/DSPChain.ts#L50)
- `mapDrive(n)` — distortion drive 0.1–50, exponential. [src/engine/dsp/DSPChain.ts:56](../../../src/engine/dsp/DSPChain.ts#L56)
- `mapEQGain(n)` — −12 dB…+12 dB, linear, `0.5` = 0 dB. [src/engine/dsp/DSPChain.ts:62](../../../src/engine/dsp/DSPChain.ts#L62)
- `mapSpeed(n)` / `mapTrajectorySpeed(n)` — movement speed curves (used by spatial movement, not by these effects). [src/engine/dsp/DSPChain.ts:73](../../../src/engine/dsp/DSPChain.ts#L73), [src/engine/dsp/DSPChain.ts:87](../../../src/engine/dsp/DSPChain.ts#L87)

**Curve generation:**

- `makeDistortionCurve(mode, drive, samples=1024)` — builds the `WaveShaperNode` transfer curve; cached by `mode:drive*100` (quantized to 2 decimals), max 64 entries, oldest evicted. [src/engine/dsp/DSPChain.ts:141](../../../src/engine/dsp/DSPChain.ts#L141)

**Chain builder / teardown:**

- `buildDSPChain(ctx, opts)` — `opts` is `{ filter, distortion, delay, reverb, eq }` (each `*Params | null`). Returns `DSPNodes | null`. [src/engine/dsp/DSPChain.ts:367](../../../src/engine/dsp/DSPChain.ts#L367)
- `destroyDSPChain(chain)` — disconnects every node in `chain.nodes`. [src/engine/dsp/DSPChain.ts:420](../../../src/engine/dsp/DSPChain.ts#L420)
- `DSPNodes` interface — `input`, `output`, `nodes[]`, plus optional `filterRef` / `distortionRef` / `delayRef` / `reverbRef` / `eqRef` exposing live node handles for runtime interpolation. [src/engine/dsp/DSPChain.ts:26](../../../src/engine/dsp/DSPChain.ts#L26)

### Effect-by-effect

**filter** — `createFilter` ([src/engine/dsp/DSPChain.ts:94](../../../src/engine/dsp/DSPChain.ts#L94)). A single `BiquadFilterNode`.
- `mode` (string) → biquad type: `lowpass`, `highpass`, `bandpass`, `notch`, `peak` (`peak` maps to `'peaking'`); unknown modes fall back to `lowpass`.
- `cutoff` 0–1 → 20 Hz–20 kHz via `mapCutoff`.
- `resonance` 0–1 → Q 0.1–20 via `mapResonance`.
- `dry_wet` 0–1 → crossfade (`dry = 1−w`, `wet = w`).

**distortion** — `createDistortion` ([src/engine/dsp/DSPChain.ts:185](../../../src/engine/dsp/DSPChain.ts#L185)). A `WaveShaperNode`, `oversample = '2x'`.
- `mode` (string) → curve shape: `softclip`, `hardclip`, `tanh`, `cubic`, `asymmetric`; unknown modes fall back to a softclip-style curve.
- `drive` 0–1 → 0.1–50 via `mapDrive`.
- `dry_wet` 0–1 → crossfade.

**delay** — `createDelay` ([src/engine/dsp/DSPChain.ts:214](../../../src/engine/dsp/DSPChain.ts#L214)). `DelayNode`(s) with a feedback `GainNode`; max delay line is 5 s.
- `time` (seconds, sampled raw — **not** normalized) → `delayTime`.
- `feedback` 0–1 → feedback gain.
- `dry_wet` 0–1 → crossfade.
- `pingPong` (boolean flag) → if set, builds a stereo L→R→L ping-pong (two delays + channel merger); otherwise a single mono delay with a feedback loop.

**reverb** — `createReverb` ([src/engine/dsp/DSPChain.ts:304](../../../src/engine/dsp/DSPChain.ts#L304)). A `ConvolverNode` fed a procedurally generated impulse response.
- `roomSize` 0–1 → decay time `0.3 + roomSize*5.7` seconds (≈0.3 s tiny … 6 s cathedral), via `generateImpulseResponse` ([src/engine/dsp/DSPChain.ts:278](../../../src/engine/dsp/DSPChain.ts#L278)).
- `damping` 0–1 → high-frequency roll-off across the IR tail.
- `dry_wet` 0–1 → crossfade.

**eq** — `createEQ` ([src/engine/dsp/DSPChain.ts:333](../../../src/engine/dsp/DSPChain.ts#L333)). Three biquads in series: low-shelf @320 Hz, mid peaking @1000 Hz (Q 0.5), high-shelf @3200 Hz. EQ has no dry/wet — it is fully in-line.
- `lowGain` / `midGain` / `highGain` each 0–1 → −12…+12 dB via `mapEQGain` (`0.5` = flat).

## Data flow

- **In:** `SatieParser` parses `filter`/`distortion`/`delay`/`reverb`/`eq` property blocks into the `*Params` structs on `Statement` ([Statement.ts](../../../src/engine/core/Statement.ts) lines 50–94). See [grammar](./grammar.md) for the surface syntax.
- The engine calls `buildDSPChain(ctx, { filter, distortion, delay, reverb, eq })` when spawning a voice and splices `input`/`output` between the source and the voice's panner — see [engine dsp](../engine/dsp.md).
- During playback, the engine reads `filterRef`/`distortionRef`/`delayRef`/`reverbRef`/`eqRef` to re-apply parameters for `InterpolationData`-driven animation (re-running the same `map*` functions / `makeDistortionCurve`).
- On voice teardown the engine calls `destroyDSPChain`.

## Invariants & gotchas

- **Fixed chain order.** Effects are always wired filter → distortion → delay → reverb → EQ. Property order in the script has no effect on signal order.
- **Two parameters escape normalization:** delay `time` is raw seconds, and trajectory/movement speeds use their own maps. Everything else under these five effects is 0–1.
- **`peak` vs `peaking`.** The DSL filter mode keyword is `peak`; it maps to the Web Audio `'peaking'` biquad type. Don't pass `peaking` from the DSL.
- **EQ is always wet.** There is no `dry_wet` for `eq`; setting all three gains to `0.5` is the only "bypass".
- **Distortion curve cache** is keyed on `mode` + drive quantized to 2 decimals. Interpolating drive across many tiny steps still mostly hits the cache; the cache holds at most 64 curves (FIFO eviction). If you add a new distortion `mode`, the default branch silently produces a softclip-style curve rather than erroring.
- **Reverb IR is random noise per build** (`Math.random()` in `generateImpulseResponse`), so two voices with identical reverb params get slightly different impulse responses. This is intentional and cheap; it is not deterministic across renders.
- `buildDSPChain` returns `null` (not an empty chain) when no effects are present — callers must handle the null branch.
- Engine rule: all DSP params must accept `RangeOrValue`, and interpolatable where musically sensible — see `.claude/rules/engine.md`.

## Change checklist

When changing this file, also touch:

1. The matching `*Params` interface in `src/engine/core/Statement.ts` if you add/rename a parameter.
2. The parser case in `SatieParser.ts` that fills the struct (and its tests) — see [grammar](./grammar.md).
3. The engine's spawn + interpolation code that consumes the `*Ref` handles — see [engine dsp](../engine/dsp.md).
4. `SatieEditor.tsx` (tokenizer, completion, hover docs) and `DocsPanel.tsx` for any new property or mode keyword.
5. This wiki page (same commit) — the pre-commit wiki gate blocks otherwise.

## Sources

- `src/engine/dsp/DSPChain.ts`
