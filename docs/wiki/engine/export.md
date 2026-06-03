---
title: Offline export — stereo, binaural, ambisonic
subsystem: engine
sources:
  - src/engine/export/OfflineRenderer.ts
  - src/engine/export/AmbisonicEncoder.ts
  - src/engine/export/WAVEncoder.ts
  - src/engine/export/index.ts
synced_sha: 52e138cee9cb
synced: 2026-05-31
related: [engine.md, spatial.md]
---

# Offline export — stereo, binaural, ambisonic

## Purpose

Render a Satie script to an `AudioBuffer` faster-than-realtime via `OfflineAudioContext`, in stereo, binaural (HRTF), or 4-channel First-Order Ambisonics, then encode it to a downloadable WAV.

## Why it exists / responsibilities

The live engine (`SatieEngine`) plays through `AudioContext` in realtime and cannot produce a file. This module re-implements the engine's playback semantics — start scheduling, `every` repetition, fades, volume/pitch/DSP interpolation, wander/trajectory motion, noise perturbation, distance rolloff — against an offline context so an export sounds the same as playback. It also owns the ambisonic encoding math (the live engine never does FOA) and the WAV serialization (incl. multichannel for ambisonic).

## Mental model

Three stages, all in the browser, no realtime audio:

```
script ──parse──▶ Statement[]
                      │  for each non-mute statement:
                      │    computeStartTimes (start + every repeats)
                      │    for each start time t:
                      │      buffer source ─▶ gain(fades+vol interp)
                      │        ─▶ [DSP chain + automation]
                      │        ─▶ panner            (stereo/binaural)
                      │           or 4× W/Y/Z/X gain (ambisonic)
                      │        ─▶ master(0.5) ─▶ [limiter] ─▶ destination
                      ▼
            OfflineAudioContext.startRendering() ─▶ AudioBuffer ─▶ encodeWAV() ─▶ Blob
```

Position motion is "baked" by sampling the trajectory/wander function at a fixed 30 Hz (`AUTOMATION_STEP`) and writing `setValueAtTime` ramps onto the panner position params (stereo/binaural) or onto the four ambisonic channel gains (FOA). The same 30 Hz loop also bakes volume/pitch and DSP-parameter interpolation. There is no per-frame mutation loop like the live engine — everything is scheduled up front.

## Key types & functions

**OfflineRenderer**
- `renderOffline(options, onProgress?): Promise<AudioBuffer>` — `src/engine/export/OfflineRenderer.ts:50`. Entry point. Parses, decodes/resamples buffers, dispatches to stereo or ambisonic path, renders.
- `RenderMode = 'stereo' | 'binaural' | 'ambisonic-foa'` — `src/engine/export/OfflineRenderer.ts:25`. Channel count is 4 for `ambisonic-foa`, else 2 (`src/engine/export/OfflineRenderer.ts:63`).
- `RenderOptions` — `src/engine/export/OfflineRenderer.ts:27`. `script`, `sampleBuffers` (raw `ArrayBuffer`s to decode), optional `decodedAudioBuffers` (pre-decoded from the live engine), `duration`, `sampleRate` (default 48000), `mode`.
- `RenderProgress` — `src/engine/export/OfflineRenderer.ts:38`. `phase` (`parsing`/`decoding`/`rendering`/`done`) + `progress` 0–1.
- `renderStereoOrBinaural(...)` — `src/engine/export/OfflineRenderer.ts:151`. Builds master gain (0.5) + `DynamicsCompressorNode` limiter, then per-statement per-start-time: source → gain → DSP → `PannerNode` (HRTF for binaural, equalpower for stereo) → master.
- `renderAmbisonicFOA(...)` — `src/engine/export/OfflineRenderer.ts:273`. Same skeleton but no panner: a `ChannelMerger(4)` (W=0,Y=1,Z=2,X=3) fed by four per-source gain nodes; no limiter.
- `scheduleParameterAutomation(...)` — `src/engine/export/OfflineRenderer.ts:395`. Bakes volume + pitch interpolation (incl. group modulation) at 30 Hz.
- `scheduleDSPAutomation(...)` — `src/engine/export/OfflineRenderer.ts:443`. Bakes filter/distortion/delay/reverb/EQ dry-wet and param interpolation, reusing `mapCutoff`/`mapResonance`/`mapDrive`/`mapEQGain`/`makeDistortionCurve` from `DSPChain`.
- `computeWanderPosition(...)` / `computeTrajectoryPosition(...)` — `src/engine/export/OfflineRenderer.ts:561` / `:594`. Sine-sum wander and LUT-trajectory evaluation with optional `noise` perturbation; mirror the live engine.
- `scheduleTrajectoryPositions` / `scheduleWanderPositions` — `src/engine/export/OfflineRenderer.ts:640` / `:657`. Write panner position ramps.
- `scheduleAmbisonicTrajectory` / `scheduleAmbisonicWander` — `src/engine/export/OfflineRenderer.ts:678` / `:701`. Write the four W/Y/Z/X channel gains over time.
- `computeStartTimes(...)` — `src/engine/export/OfflineRenderer.ts:733`. First `start` plus repeats spaced by a once-sampled `every` interval up to `duration`.
- `computeVoiceDuration(...)` — `src/engine/export/OfflineRenderer.ts:756`. `duration` > (`end`-`start`) > (loop/persistent → to end) > buffer length, clamped to remaining time.
- `computeStaticPosition(...)` — `src/engine/export/OfflineRenderer.ts:774`. `None` → area center, `Fixed` → `areaMin`, else center.
- `applyFades(...)` — `src/engine/export/OfflineRenderer.ts:794`. `fade_in`/`fade_out` linear ramps; overrides the 5ms micro-fade.
- `resolveBuffer(...)` — `src/engine/export/OfflineRenderer.ts:728`. Looks up by `pathFor(clip)` then raw clip name.

**AmbisonicEncoder**
- `computeFOAGains(x, y, z): AmbisonicGains` — `src/engine/export/AmbisonicEncoder.ts:25`. AmbiX (ACN order, SN3D norm): `w=1`, `y=sin(az)cos(el)`, `z=sin(el)`, `x=cos(az)cos(el)`. Source at origin (dist < 1e-8) → omni `{w:1,...}`.
- `distanceAttenuation(distance, refDistance=1, maxDistance=100, rolloff=1)` — `src/engine/export/AmbisonicEncoder.ts:59`. Inverse-distance gain in [0,1]. Renderer calls it as `(dist, 1, 50, 2)` to match the live panner's `refDistance=1`, `maxDistance=50`, `rolloffFactor=2`.
- `AmbisonicGains` — `src/engine/export/AmbisonicEncoder.ts:8`. `{ w, y, z, x }`.

**WAVEncoder**
- `encodeWAV(buffer, bitDepth=16): Blob` — `src/engine/export/WAVEncoder.ts:38`. Interleaves channels to PCM. 1–2ch → `WAVE_FORMAT_PCM`; 3+ch → `WAVE_FORMAT_EXTENSIBLE` (40-byte fmt chunk, PCM SubFormat GUID, `dwChannelMask=0`) so ambisonic files are valid. Supports 16- or 24-bit; samples clamped to [-1,1].
- `downloadBlob(blob, filename)` — `src/engine/export/WAVEncoder.ts:131`. Anchor-click download.

**index.ts** — `src/engine/export/index.ts` re-exports `renderOffline`/`RenderMode`/`RenderOptions`/`RenderProgress`, `encodeWAV`/`downloadBlob`, `computeFOAGains`/`distanceAttenuation`/`AmbisonicGains`.

## Data flow

- **Called in by:** `ExportPanel.tsx` (the UI export panel) — it gathers the script, the live engine's decoded audio buffers, duration, and mode, calls `renderOffline`, then `encodeWAV` + `downloadBlob`.
- **Calls out to:** [parser](./_index.md) `parse` / `pathFor`, `Statement`/`WanderType`/`isTrajectoryWanderType`, `InterpolationData`, [dsp](./dsp.md) `buildDSPChain` + the `map*` helpers + `makeDistortionCurve`, [spatial](./spatial.md) `getTrajectory`, and the static method `SatieEngine.evalModulation` (so offline interpolation is byte-for-byte the live engine's, via the `evalModulation` wrapper at `src/engine/export/OfflineRenderer.ts:141`).

## Invariants & gotchas

- **Parity with the live engine is the whole point.** Constants are copied, not abstracted: master gain `0.5` (-6 dB headroom), limiter threshold -2 / ratio 20 / attack 0.0005 / release 0.05, panner `distanceModel='inverse'`, `refDistance=1`, `maxDistance=50`, `rolloffFactor=2`. The ambisonic path reproduces this rolloff manually via `distanceAttenuation(dist, 1, 50, 2)`. If you change any of these in `SatieEngine`/`DSPChain`, change them here too or exports will drift.
- **30 Hz bake rate** (`AUTOMATION_FPS`, `src/engine/export/OfflineRenderer.ts:44`) matches the live engine's 30fps panner cap. Automation is `setValueAtTime` steps, not smooth ramps — fine at 30 Hz, but it is sampling, not exact.
- **`every` interval is sampled once** and reused for all repeats (`computeStartTimes`), matching live-engine behavior — not re-sampled per repeat.
- **`seed = Math.random()*1000` per source** drives wander phase/noise, so motion is non-deterministic across renders (same as live). Don't assume bit-identical exports.
- **Ambisonic uses only the static-position helper for the initial encode** then overwrites the four gains per-step for moving sources; there is no `PannerNode` HRTF in FOA — directionality is purely the W/Y/Z/X gain matrix.
- **`computeFOAGains` azimuth/elevation are derived from Web Audio coordinates** (azimuth in XZ plane from +X, +Z is "right"; elevation toward +Y). This must agree with how the viewport and panner interpret position.
- **Multichannel WAV requires EXTENSIBLE format.** Writing a 4-ch ambisonic file as plain PCM produces files many tools reject; the >2ch branch in `encodeWAV` handles this. `dwChannelMask=0` marks it speaker-order-independent (correct for ambisonic).
- **Buffer resampling:** pre-decoded buffers at a different sample rate are linearly resampled (`src/engine/export/OfflineRenderer.ts:84`); raw `ArrayBuffer`s are decoded by the offline context directly. A failed decode logs a warning and skips that statement's audio.

## Change checklist

- Changing engine playback constants (master gain, limiter, distance model, fade timing) → mirror them in both `renderStereoOrBinaural` and `renderAmbisonicFOA`.
- Adding a DSP effect → wire its automation into `scheduleDSPAutomation` and its build into the `buildDSPChain` call sites (both render paths), or it won't export.
- Adding a trajectory/`WanderType` → ensure `getTrajectory` resolves it and that `isTrajectoryWanderType` returns true so `computeTrajectoryPosition` is used (mirrors CLAUDE.md "Adding a new trajectory type" → "Add wander scheduling in `OfflineRenderer.ts`").
- Adding an interpolatable property → extend `scheduleParameterAutomation` (or `scheduleDSPAutomation`) and confirm `SatieEngine.evalModulation` covers it.
- Adding a new render mode or channel layout → update `RenderMode`, the channel-count branch, the render dispatch, and `encodeWAV`'s format selection.

## Sources

- `src/engine/export/OfflineRenderer.ts`
- `src/engine/export/AmbisonicEncoder.ts`
- `src/engine/export/WAVEncoder.ts`
- `src/engine/export/index.ts`
