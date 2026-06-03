---
title: DSP chain — DSPChain.ts
subsystem: engine
sources:
  - src/engine/dsp/DSPChain.ts
synced_sha: 83bf4e7fcb78
synced: 2026-05-31
related: [engine.md, ../dsl/dsp-effects.md]
---

## Purpose

Builds a per-voice native Web Audio effect chain (filter, distortion, delay, reverb, EQ) and returns its input/output nodes plus refs for runtime parameter interpolation.

## Why it exists / responsibilities

- Turn parsed DSL effect params into actual Web Audio node graphs, one per voice.
- Run all processing on the browser's audio thread — no AudioWorklets, no per-sample JS.
- Normalize the DSL's 0–1 parameter convention to real audio ranges (Hz, dB, Q, drive).
- Expose live node references (`filterRef`, `distortionRef`, etc.) so the engine can interpolate parameters per frame without rebuilding the graph.
- Provide clean teardown via `destroyDSPChain`.

Each effect is a dry/wet split: the input fans out to a `dry` GainNode (straight through) and a `wet` GainNode (post-effect). Both sum into a shared `output` GainNode, so `dryWet` is a crossfade where `dry.gain = 1 - w` and `wet.gain = w`.

## Mental model

Fixed processing order; only active effects are included, and they're wired in series:

```
source → [filter] → [distortion] → [delay] → [reverb] → [EQ] → output
```

Within one effect (filter/distortion/delay/reverb), the topology is always the same dry/wet split:

```
input ─┬─→ dry ──────────────→ output
       └─→ <effect node> → wet ─┘
```

EQ is the exception: it's a pure series chain (low → mid → high) with no dry/wet split.

## Key types & functions

- `DSPNodes` interface — return shape: `input`, `output`, `nodes[]` (for cleanup), plus optional per-effect refs. src/engine/dsp/DSPChain.ts:26
- `buildDSPChain(ctx, opts)` — the public entry point. Builds each requested effect, pushes active ones in fixed order, wires them in series, attaches refs. Returns `null` if no effects are active. src/engine/dsp/DSPChain.ts:367
- `destroyDSPChain(chain)` — disconnects every node in `chain.nodes` (swallows already-disconnected errors). src/engine/dsp/DSPChain.ts:420

Value normalization helpers (0–1 → real ranges):

- `mapCutoff(n)` — 20 Hz–20000 Hz, exponential. src/engine/dsp/DSPChain.ts:44
- `mapResonance(n)` — 0.1–20 (filter Q), exponential. src/engine/dsp/DSPChain.ts:50
- `mapDrive(n)` — 0.1–50 (distortion drive), exponential. src/engine/dsp/DSPChain.ts:56
- `mapEQGain(n)` — -12 dB to +12 dB, linear (0.5 = 0 dB). src/engine/dsp/DSPChain.ts:62
- `mapSpeed(n)` — fly/walk sine wander speed (0.005–2.0 Hz). src/engine/dsp/DSPChain.ts:73
- `mapTrajectorySpeed(n)` — flatter curve for spiral/orbit/lorenz/custom LUT wander. src/engine/dsp/DSPChain.ts:87
- `makeDistortionCurve(mode, drive, samples=1024)` — exported, cached (`_curveCache`, max 64 entries, key quantized to 2 decimals of drive). Modes: `softclip`, `hardclip`, `tanh`, `cubic`, `asymmetric`, default softclip fallback. src/engine/dsp/DSPChain.ts:141

Private builders (one per effect), each returning its effect-specific node refs plus `input`/`output`/`nodes`:

- `createFilter` — `BiquadFilterNode`; mode map `lowpass/highpass/bandpass/notch/peak(→peaking)`, default `lowpass`. src/engine/dsp/DSPChain.ts:94
- `createDistortion` — `WaveShaperNode` with `oversample = '2x'`. src/engine/dsp/DSPChain.ts:185
- `createDelay` — mono feedback delay, or stereo ping-pong (L→R→L) when `params.pingPong`. Both delay lines are 5 s max. src/engine/dsp/DSPChain.ts:214
- `generateImpulseResponse(ctx, roomSize, damping)` — synthesizes a stereo IR: decay 0.3 s–6 s by room size, exponential envelope, high-frequency damping, white noise. src/engine/dsp/DSPChain.ts:278
- `createReverb` — `ConvolverNode` fed the generated IR. src/engine/dsp/DSPChain.ts:304
- `createEQ` — 3-band: low shelf @320 Hz, mid peaking @1000 Hz (Q 0.5), high shelf @3200 Hz, in series. src/engine/dsp/DSPChain.ts:333

## Data flow

`buildDSPChain` is called by the [engine](./engine.md) (`SatieEngine`) when a voice/track is created. The engine reads effect `*Params` off the parsed `Statement`, passes them in `opts`, then connects the voice source into `result.input` and `result.output` into the rest of the per-voice chain (gain → panner → master).

Inputs come from parsed DSL params in `../core/Statement` (`FilterParams`, `DistortionParams`, `DelayParams`, `ReverbParams`, `EQParams`). Each param value is a `RangeOrValue`, read here via `.sample()`. See the DSL surface in [dsp-effects](../dsl/dsp-effects.md).

Outputs back to the engine: the `DSPNodes` refs (`filterRef`, `distortionRef`, `delayRef`, `reverbRef`, `eqRef`) are how the engine performs per-frame parameter interpolation — it writes directly onto the exposed `AudioParam`s / GainNodes rather than rebuilding the graph.

## Invariants & gotchas

- **Chain order is fixed** and independent of `opts` key order: it's determined by the push order in `buildDSPChain` (filter → distortion → delay → reverb → EQ), not by which params are present.
- `buildDSPChain` returns `null` when no effects are active — callers must handle the no-chain case (connect source straight through).
- Every effect creates its own `input`/`output` GainNodes; series wiring connects `effects[i].output → effects[i+1].input`. `DSPNodes.input` is the first effect's input, `DSPNodes.output` is the last effect's output.
- Dry/wet is a gain crossfade, not a bypass: `dry.gain = 1 - w`, `wet.gain = w`. EQ has no wet/dry (pure series), so there's no `dryWet` for it.
- Distortion curves are cached and shared (`_curveCache`) to avoid reallocating `Float32Array`s every interpolation frame; cache key quantizes drive to 2 decimals, so very small drive changes may reuse a curve.
- `mapSpeed` vs `mapTrajectorySpeed`: trajectories visit more spatial ground per cycle than fly's sines, so they use a flatter curve (`12^n` vs `400^n`) — don't swap them.
- Reverb IR is regenerated white noise per `createReverb` call; it is not deterministic across builds.
- `destroyDSPChain` only disconnects — the engine is responsible for actually dropping references so the nodes get GC'd.

## Change checklist

When adding a new DSP effect (see also the `add-effect` skill and CLAUDE.md "Adding a new DSP effect"):

1. Add a `create<Effect>` builder here returning `{ ...effectRefs, input, output, nodes }` — follow `createReverb` as a template; use the dry/wet split unless it's a pure-series effect like EQ.
2. Add a `<Effect>Ref` field to `DSPNodes`. src/engine/dsp/DSPChain.ts:26
3. In `buildDSPChain`: add the `opts.<effect>` arg, build it, and `push` it in the correct position in the fixed chain order; attach its ref. src/engine/dsp/DSPChain.ts:367
4. Add the params interface to `../core/Statement` and a parser in `SatieParser.ts`.
5. Wire engine-side: pass the params in `opts`, and add per-frame interpolation against the new ref in `SatieEngine`.
6. Add any new 0–1 → real-range mapping as a `map*` helper here.

## Sources

- src/engine/dsp/DSPChain.ts
