---
title: Audio analysis — audioAnalysis.ts
subsystem: lib
sources:
  - src/lib/audioAnalysis.ts
synced_sha: 5d9c7100cdab
synced: 2026-05-31
related: [community.md]
---

## Purpose

Pure client-side audio feature extraction from an `AudioBuffer`, used to seed AI auto-tagging of community samples.

## Why it exists / responsibilities

When a user uploads a sample to the community library, we want descriptive tags without forcing them to type any. Rather than ship raw audio to the model, we extract a compact, numeric fingerprint (loudness, brightness, noisiness, duration) and let the AI reason over those numbers plus the filename. This file owns that extraction step:

- Compute level metrics (RMS, peak amplitude).
- Estimate timbre (spectral centroid) and texture (zero-crossing rate).
- Produce a small waveform peak array for visualization.
- Do all of it offline (no real-time nodes, no `AudioContext` graph), so it can run synchronously on mount.

## Mental model

```
AudioBuffer ──analyzeAudioBuffer──▶ AudioFeatures
                                       ├─ rms / peakAmplitude   (level)
                                       ├─ spectralCentroid Hz   (brightness)
                                       ├─ zeroCrossingRate      (noisiness)
                                       ├─ waveformPeaks[~100]    (UI render)
                                       └─ durationMs / sampleRate / channels
```

Think of it as a one-shot "describe this sound in numbers" pass. Only the **first channel** is analyzed (`buffer.getChannelData(0)`); the centroid is estimated from a single 4096-sample window in the **middle** of the clip, not the whole file.

## Key types & functions

- `AudioFeatures` (interface) — src/lib/audioAnalysis.ts:6. The full feature record: `durationMs`, `rms`, `peakAmplitude`, `spectralCentroid` (Hz), `zeroCrossingRate` (0–1), `waveformPeaks` (~100 normalized values), `sampleRate`, `channels`.
- `analyzeAudioBuffer(buffer: AudioBuffer): AudioFeatures` — src/lib/audioAnalysis.ts:21. The only export. Single pass for RMS/peak, second pass for zero crossings, then delegates centroid + waveform.
- `estimateSpectralCentroid(samples, sampleRate)` — src/lib/audioAnalysis.ts:68 (internal). Hann-windowed naive DFT over a 4096-sample middle segment; returns the magnitude-weighted mean frequency. Returns `0` if the segment is shorter than 64 samples or has no energy.
- `computeWaveformPeaks(samples, numBins)` — src/lib/audioAnalysis.ts:111 (internal). Splits the buffer into `numBins` bins (called with 100) and returns the max absolute sample per bin, rounded to 3 decimals.

## Data flow

In:
- [CommunityUploadDialog](../ui/community-ui.md) calls `analyzeAudioBuffer(audioBuffer)` synchronously on mount (`src/ui/components/CommunityUploadDialog.tsx:63`), stores the result in state, and feeds `waveformPeaks` straight into its canvas waveform draw.

Out:
- The dialog then passes the `AudioFeatures` to `suggestTags(filename, features)` in `src/lib/communityTagging.ts:35`, which turns the numbers into a human-readable summary (e.g. `rms` → "quiet"/"loud", `spectralCentroid` → "dark"/"bright", `zeroCrossingRate` → "tonal"/"percussive") and asks the fast AI provider for tags + a description. AI tagging is best-effort and does not block the UI.

This module has no React, no Supabase, and no network calls — it is a leaf utility.

## Invariants & gotchas

- **First channel only.** Stereo content is collapsed to channel 0; `channels` is reported separately but never analyzed.
- **Centroid is an estimate, not a full-file FFT.** It uses one middle window and an O(n²) DFT (4096 samples → ~2048 bins × 4096 taps). Fine for short samples; do not call it in a hot loop or on very long buffers expecting speed.
- **Centroid window can miss the signal.** Silence in the exact middle of a clip yields a misleadingly low centroid (or 0). The textual buckets in `communityTagging.ts` mask this somewhat.
- **Values are rounded** at the boundary (rms/peak to 3 dp, zeroCrossingRate to 4 dp, centroid to integer Hz) — these are display/AI-prompt numbers, not precise DSP measurements.
- **`waveformPeaks` length is not guaranteed to equal `numBins`** if `samples.length < numBins` (binSize floors to 0 → returns `Array(numBins).fill(0)`); otherwise it pushes exactly `numBins` values.

## Change checklist

- Adding/removing an `AudioFeatures` field → update the interface (src/lib/audioAnalysis.ts:6) **and** the prompt summary in `src/lib/communityTagging.ts` so the new feature reaches the model.
- Changing `numBins` (currently 100) → check the waveform canvas draw in `CommunityUploadDialog.tsx` does not assume a fixed length.
- Reworking the centroid algorithm → keep the `0`-on-empty contract so the textual bucketing in `communityTagging.ts` stays safe.
- Update this page and the [community](./community.md) page in the same commit (wiki gate).

## Sources

- src/lib/audioAnalysis.ts
