/**
 * Offline audio renderer for Satie compositions.
 *
 * Renders a Satie script to an AudioBuffer using OfflineAudioContext.
 * Supports three modes:
 *   - stereo: 2ch with equalpower panning
 *   - binaural: 2ch with HRTF panning
 *   - ambisonic-foa: 4ch First-Order Ambisonics (AmbiX: W, Y, Z, X)
 *
 * This renderer faithfully replicates the live engine's behavior:
 *   - Parameter interpolation (volume, pitch, DSP automation)
 *   - Noise perturbation on trajectories
 *   - Matched rolloff/distance model
 *   - Proper loop timing
 */

import { parse, pathFor } from '../core/SatieParser';
import { Statement, WanderType, isTrajectoryWanderType } from '../core/Statement';
import { InterpolationData, ModulationType, LoopMode } from '../core/InterpolationData';
import { buildDSPChain, destroyDSPChain, makeDistortionCurve, mapCutoff, mapResonance, mapDrive, mapEQGain, mapSpeed } from '../dsp/DSPChain';
import { getTrajectory } from '../spatial/Trajectories';
import { computeFOAGains, distanceAttenuation } from './AmbisonicEncoder';
import { SatieEngine } from '../core/SatieEngine';

export type RenderMode = 'stereo' | 'binaural' | 'ambisonic-foa';

export interface RenderOptions {
  script: string;
  /** Raw ArrayBuffer data (will be decoded into the offline context) */
  sampleBuffers: Map<string, ArrayBuffer>;
  /** Pre-decoded AudioBuffers from the live engine (used as-is if sample rates match, re-encoded otherwise) */
  decodedAudioBuffers?: ReadonlyMap<string, AudioBuffer>;
  duration: number;
  sampleRate?: number;
  mode: RenderMode;
}

export interface RenderProgress {
  phase: 'parsing' | 'decoding' | 'rendering' | 'done';
  progress: number; // 0-1
}

/** Automation update rate for offline rendering (Hz) */
const AUTOMATION_FPS = 30;
const AUTOMATION_STEP = 1 / AUTOMATION_FPS;

/**
 * Render a Satie script offline to an AudioBuffer.
 */
export async function renderOffline(
  options: RenderOptions,
  onProgress?: (p: RenderProgress) => void,
): Promise<AudioBuffer> {
  const { script, sampleBuffers, decodedAudioBuffers, duration, mode } = options;
  const sampleRate = options.sampleRate ?? 48000;

  onProgress?.({ phase: 'parsing', progress: 0 });

  // Parse the script
  const statements = parse(script);

  // Determine channel count
  const channelCount = mode === 'ambisonic-foa' ? 4 : 2;

  // Create offline context
  const offlineCtx = new OfflineAudioContext(
    channelCount,
    Math.ceil(sampleRate * duration),
    sampleRate,
  );

  onProgress?.({ phase: 'decoding', progress: 0.1 });

  // Build the decoded buffer map
  const decodedBuffers = new Map<string, AudioBuffer>();

  // Copy pre-decoded buffers from the live engine
  if (decodedAudioBuffers) {
    for (const [name, buf] of decodedAudioBuffers) {
      if (buf.sampleRate === sampleRate) {
        decodedBuffers.set(name, buf);
      } else {
        // Resample with linear interpolation (higher quality than nearest-neighbor)
        const newBuf = offlineCtx.createBuffer(buf.numberOfChannels,
          Math.ceil(buf.duration * sampleRate), sampleRate);
        for (let ch = 0; ch < buf.numberOfChannels; ch++) {
          const src = buf.getChannelData(ch);
          const dst = newBuf.getChannelData(ch);
          const ratio = buf.sampleRate / sampleRate;
          for (let i = 0; i < dst.length; i++) {
            const srcPos = i * ratio;
            const i0 = Math.floor(srcPos);
            const i1 = Math.min(i0 + 1, src.length - 1);
            const frac = srcPos - i0;
            dst[i] = src[i0] + (src[i1] - src[i0]) * frac;
          }
        }
        decodedBuffers.set(name, newBuf);
      }
    }
  }

  // Decode raw ArrayBuffers sequentially
  const bufferEntries = Array.from(sampleBuffers.entries());
  for (let i = 0; i < bufferEntries.length; i++) {
    const [name, arrayBuffer] = bufferEntries[i];
    if (decodedBuffers.has(name)) continue;
    try {
      const copy = arrayBuffer.slice(0);
      const decoded = await offlineCtx.decodeAudioData(copy);
      decodedBuffers.set(name, decoded);
    } catch (e) {
      console.warn(`[OfflineRenderer] Failed to decode "${name}":`, e);
    }
    onProgress?.({ phase: 'decoding', progress: 0.1 + 0.2 * ((i + 1) / bufferEntries.length) });
  }

  onProgress?.({ phase: 'rendering', progress: 0.3 });

  // Create master output
  let sourcesScheduled: number;
  if (mode === 'ambisonic-foa') {
    sourcesScheduled = renderAmbisonicFOA(offlineCtx, statements, decodedBuffers, duration);
  } else {
    sourcesScheduled = renderStereoOrBinaural(offlineCtx, statements, decodedBuffers, duration, mode);
  }

  console.log(`[OfflineRenderer] ${sourcesScheduled} sources scheduled for ${duration}s render`);
  onProgress?.({ phase: 'rendering', progress: 0.5 });

  // Render
  const result = await offlineCtx.startRendering();

  onProgress?.({ phase: 'done', progress: 1 });

  return result;
}

// ── Interpolation evaluation (mirrors SatieEngine.evalModulation) ──

function evalModulation(mod: InterpolationData, elapsed: number, every: number): number {
  return SatieEngine.evalModulation(mod, elapsed, every);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// ── Stereo / Binaural rendering ─────────────────────────────

function renderStereoOrBinaural(
  ctx: OfflineAudioContext,
  statements: Statement[],
  buffers: Map<string, AudioBuffer>,
  duration: number,
  mode: RenderMode,
): number {
  // Master gain + limiter matching live engine
  const masterGain = ctx.createGain();
  masterGain.gain.value = 0.5; // -6 dB headroom — matches live engine
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -2;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.0005;
  limiter.release.value = 0.05;
  masterGain.connect(limiter);
  limiter.connect(ctx.destination);

  let sourcesScheduled = 0;

  for (const stmt of statements) {
    if (stmt.mute) continue;

    const audioBuffer = resolveBuffer(buffers, stmt.clip);
    if (!audioBuffer) {
      console.warn(`[OfflineRenderer] Missing buffer for "${stmt.clip}" (pathFor="${pathFor(stmt.clip)}")`);
      continue;
    }

    const startTime = stmt.start.sample();
    const volume = stmt.volume.sample();
    const pitch = stmt.pitch.sample();

    // Calculate repetitions based on 'every' and duration
    const times = computeStartTimes(stmt, startTime, duration, audioBuffer.duration);

    for (let ti = 0; ti < times.length; ti++) {
      const t = times[ti];
      if (t >= duration) break;

      const seed = Math.random() * 1000;
      const wanderHz = mapSpeed(stmt.wanderHz.sample());

      // Source
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.playbackRate.setValueAtTime(pitch, t);
      if (stmt.kind === 'loop') source.loop = true;

      // Gain with micro-fade on start
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(volume, t + 0.005);

      // Fade in/out
      applyFades(gain, stmt, t, audioBuffer.duration, duration);

      // Schedule parameter interpolation (volume, pitch)
      const voiceDuration = computeVoiceDuration(stmt, audioBuffer.duration, duration - t);
      scheduleParameterAutomation(gain, source, stmt, t, voiceDuration, volume, pitch, seed);

      // Panner — matched to live engine
      const panner = ctx.createPanner();
      panner.panningModel = mode === 'binaural' ? 'HRTF' : 'equalpower';
      panner.distanceModel = 'inverse';
      panner.refDistance = 1;
      panner.maxDistance = 50;   // match live engine
      panner.rolloffFactor = 2; // match live engine

      // Set initial position at voice start time
      const pos = computeStaticPosition(stmt);
      panner.positionX.setValueAtTime(pos.x, t);
      panner.positionY.setValueAtTime(pos.y, t);
      panner.positionZ.setValueAtTime(pos.z, t);

      // Schedule position changes if applicable
      if (isTrajectoryWanderType(stmt.wanderType)) {
        scheduleTrajectoryPositions(panner, stmt, t, Math.min(t + voiceDuration, duration), seed, wanderHz);
      } else if (stmt.wanderType === WanderType.Walk || stmt.wanderType === WanderType.Fly) {
        scheduleWanderPositions(panner, stmt, t, Math.min(t + voiceDuration, duration), seed, wanderHz);
      }

      // DSP chain
      const dsp = buildDSPChain(ctx as unknown as AudioContext, {
        filter: stmt.filterParams,
        distortion: stmt.distortionParams,
        delay: stmt.delayParams,
        reverb: stmt.reverbParams,
        eq: stmt.eqParams,
      });

      // Schedule DSP parameter automation
      if (dsp) {
        scheduleDSPAutomation(dsp, stmt, t, voiceDuration);
      }

      // Connect: source → gain → [DSP] → panner → master
      source.connect(gain);
      if (dsp) {
        gain.connect(dsp.input);
        dsp.output.connect(panner);
      } else {
        gain.connect(panner);
      }
      panner.connect(masterGain);

      // Schedule start/stop
      source.start(t);
      source.stop(t + voiceDuration);

      sourcesScheduled++;
    }
  }

  return sourcesScheduled;
}

// ── Ambisonic FOA rendering ─────────────────────────────────

function renderAmbisonicFOA(
  ctx: OfflineAudioContext,
  statements: Statement[],
  buffers: Map<string, AudioBuffer>,
  duration: number,
): number {
  // 4-channel merger: W(0), Y(1), Z(2), X(3)
  const merger = ctx.createChannelMerger(4);
  // Master gain matching live engine
  const masterGain = ctx.createGain();
  masterGain.gain.value = 0.5;
  merger.connect(masterGain);
  masterGain.connect(ctx.destination);

  let sourcesScheduled = 0;

  for (const stmt of statements) {
    if (stmt.mute) continue;

    const audioBuffer = resolveBuffer(buffers, stmt.clip);
    if (!audioBuffer) continue;

    const startTime = stmt.start.sample();
    const volume = stmt.volume.sample();
    const pitch = stmt.pitch.sample();
    const times = computeStartTimes(stmt, startTime, duration, audioBuffer.duration);

    for (let ti = 0; ti < times.length; ti++) {
      const t = times[ti];
      if (t >= duration) break;

      const seed = Math.random() * 1000;
      const wanderHz = mapSpeed(stmt.wanderHz.sample());

      // Source
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.playbackRate.setValueAtTime(pitch, t);
      if (stmt.kind === 'loop') source.loop = true;

      // Volume gain with micro-fade
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(volume, t + 0.005);
      applyFades(gain, stmt, t, audioBuffer.duration, duration);

      const voiceDuration = computeVoiceDuration(stmt, audioBuffer.duration, duration - t);
      scheduleParameterAutomation(gain, source, stmt, t, voiceDuration, volume, pitch, seed);

      // DSP chain
      const dsp = buildDSPChain(ctx as unknown as AudioContext, {
        filter: stmt.filterParams,
        distortion: stmt.distortionParams,
        delay: stmt.delayParams,
        reverb: stmt.reverbParams,
        eq: stmt.eqParams,
      });

      if (dsp) {
        scheduleDSPAutomation(dsp, stmt, t, voiceDuration);
      }

      // Connect source → gain → [DSP] → dspOut
      source.connect(gain);
      const dspOut = ctx.createGain();
      if (dsp) {
        gain.connect(dsp.input);
        dsp.output.connect(dspOut);
      } else {
        gain.connect(dspOut);
      }

      // Ambisonic encoding: 4 gain nodes for W, Y, Z, X
      const pos = computeStaticPosition(stmt);
      const gains = computeFOAGains(pos.x, pos.y, pos.z);
      const dist = Math.sqrt(pos.x * pos.x + pos.y * pos.y + pos.z * pos.z);
      const atten = distanceAttenuation(dist, 1, 50, 2); // match live engine rolloff

      const wGain = ctx.createGain();
      const yGain = ctx.createGain();
      const zGain = ctx.createGain();
      const xGain = ctx.createGain();

      wGain.gain.setValueAtTime(gains.w * atten, t);
      yGain.gain.setValueAtTime(gains.y * atten, t);
      zGain.gain.setValueAtTime(gains.z * atten, t);
      xGain.gain.setValueAtTime(gains.x * atten, t);

      dspOut.connect(wGain);
      dspOut.connect(yGain);
      dspOut.connect(zGain);
      dspOut.connect(xGain);

      wGain.connect(merger, 0, 0);
      yGain.connect(merger, 0, 1);
      zGain.connect(merger, 0, 2);
      xGain.connect(merger, 0, 3);

      // Schedule position-based gain automation for moving sources
      if (isTrajectoryWanderType(stmt.wanderType)) {
        scheduleAmbisonicTrajectory(ctx, wGain, yGain, zGain, xGain, stmt, t,
          Math.min(t + voiceDuration, duration), seed, wanderHz);
      } else if (stmt.wanderType === WanderType.Walk || stmt.wanderType === WanderType.Fly) {
        scheduleAmbisonicWander(ctx, wGain, yGain, zGain, xGain, stmt, t,
          Math.min(t + voiceDuration, duration), seed, wanderHz);
      }

      // Schedule
      source.start(t);
      source.stop(t + voiceDuration);

      sourcesScheduled++;
    }
  }

  return sourcesScheduled;
}

// ── Parameter automation (volume, pitch interpolation) ──────

function scheduleParameterAutomation(
  gain: GainNode,
  source: AudioBufferSourceNode,
  stmt: Statement,
  startTime: number,
  voiceDuration: number,
  baseVolume: number,
  basePitch: number,
  _seed: number,
): void {
  const endTime = startTime + voiceDuration;
  const hasVolumeInterp = !!stmt.volumeInterpolation || !!stmt.groupVolumeModulation;
  const hasPitchInterp = !!stmt.pitchInterpolation || !!stmt.groupPitchModulation;

  if (!hasVolumeInterp && !hasPitchInterp) return;

  const volumeEvery = stmt.volumeInterpolation ? stmt.volumeInterpolation.every.sample() : 0;
  const groupVolEvery = stmt.groupVolumeModulation ? stmt.groupVolumeModulation.every.sample() : 0;
  const pitchEvery = stmt.pitchInterpolation ? stmt.pitchInterpolation.every.sample() : 0;
  const groupPitchEvery = stmt.groupPitchModulation ? stmt.groupPitchModulation.every.sample() : 0;

  for (let t = startTime; t < endTime; t += AUTOMATION_STEP) {
    const elapsed = t - startTime;

    if (hasVolumeInterp) {
      let vol = stmt.volumeInterpolation
        ? evalModulation(stmt.volumeInterpolation, elapsed, volumeEvery)
        : baseVolume;
      if (stmt.groupVolumeModulation) {
        vol *= evalModulation(stmt.groupVolumeModulation, elapsed, groupVolEvery);
      }
      gain.gain.setValueAtTime(vol, t);
    }

    if (hasPitchInterp) {
      let p = stmt.pitchInterpolation
        ? evalModulation(stmt.pitchInterpolation, elapsed, pitchEvery)
        : basePitch;
      if (stmt.groupPitchModulation) {
        p *= evalModulation(stmt.groupPitchModulation, elapsed, groupPitchEvery);
      }
      source.playbackRate.setValueAtTime(p, t);
    }
  }
}

// ── DSP parameter automation ────────────────────────────────

function scheduleDSPAutomation(
  dsp: ReturnType<typeof buildDSPChain>,
  stmt: Statement,
  startTime: number,
  voiceDuration: number,
): void {
  if (!dsp) return;
  const endTime = startTime + voiceDuration;

  // Pre-cache every durations
  const fp = stmt.filterParams;
  const dp = stmt.distortionParams;
  const dlp = stmt.delayParams;
  const rp = stmt.reverbParams;
  const eq = stmt.eqParams;

  const hasFilterInterp = fp && (fp.cutoffInterpolation || fp.resonanceInterpolation || fp.dryWetInterpolation);
  const hasDistInterp = dp && (dp.driveInterpolation || dp.dryWetInterpolation);
  const hasDelayInterp = dlp && (dlp.timeInterpolation || dlp.feedbackInterpolation || dlp.dryWetInterpolation);
  const hasReverbInterp = rp && rp.dryWetInterpolation;
  const hasEqInterp = eq && (eq.lowGainInterpolation || eq.midGainInterpolation || eq.highGainInterpolation);

  if (!hasFilterInterp && !hasDistInterp && !hasDelayInterp && !hasReverbInterp && !hasEqInterp) return;

  // Cache every values
  const filterCutoffEvery = fp?.cutoffInterpolation?.every.sample() ?? 0;
  const filterResEvery = fp?.resonanceInterpolation?.every.sample() ?? 0;
  const filterDWEvery = fp?.dryWetInterpolation?.every.sample() ?? 0;
  const distDriveEvery = dp?.driveInterpolation?.every.sample() ?? 0;
  const distDWEvery = dp?.dryWetInterpolation?.every.sample() ?? 0;
  const delayTimeEvery = dlp?.timeInterpolation?.every.sample() ?? 0;
  const delayFbEvery = dlp?.feedbackInterpolation?.every.sample() ?? 0;
  const delayDWEvery = dlp?.dryWetInterpolation?.every.sample() ?? 0;
  const reverbDWEvery = rp?.dryWetInterpolation?.every.sample() ?? 0;
  const eqLowEvery = eq?.lowGainInterpolation?.every.sample() ?? 0;
  const eqMidEvery = eq?.midGainInterpolation?.every.sample() ?? 0;
  const eqHighEvery = eq?.highGainInterpolation?.every.sample() ?? 0;

  for (let t = startTime; t < endTime; t += AUTOMATION_STEP) {
    const elapsed = t - startTime;

    // Filter automation (0-1 → real ranges)
    if (hasFilterInterp && dsp.filterRef) {
      if (fp!.cutoffInterpolation) {
        dsp.filterRef.filter.frequency.setValueAtTime(
          mapCutoff(evalModulation(fp!.cutoffInterpolation, elapsed, filterCutoffEvery)), t);
      }
      if (fp!.resonanceInterpolation) {
        dsp.filterRef.filter.Q.setValueAtTime(
          mapResonance(evalModulation(fp!.resonanceInterpolation, elapsed, filterResEvery)), t);
      }
      if (fp!.dryWetInterpolation) {
        const w = clamp01(evalModulation(fp!.dryWetInterpolation, elapsed, filterDWEvery));
        dsp.filterRef.wet.gain.setValueAtTime(w, t);
        dsp.filterRef.dry.gain.setValueAtTime(1 - w, t);
      }
    }

    // Distortion automation
    if (hasDistInterp && dsp.distortionRef) {
      if (dp!.driveInterpolation) {
        const drive = mapDrive(evalModulation(dp!.driveInterpolation, elapsed, distDriveEvery));
        dsp.distortionRef.shaper.curve = makeDistortionCurve(
          dsp.distortionRef.mode, drive) as unknown as Float32Array<ArrayBuffer>;
      }
      if (dp!.dryWetInterpolation) {
        const w = clamp01(evalModulation(dp!.dryWetInterpolation, elapsed, distDWEvery));
        dsp.distortionRef.wet.gain.setValueAtTime(w, t);
        dsp.distortionRef.dry.gain.setValueAtTime(1 - w, t);
      }
    }

    // Delay automation
    if (hasDelayInterp && dsp.delayRef) {
      if (dlp!.timeInterpolation) {
        const val = evalModulation(dlp!.timeInterpolation, elapsed, delayTimeEvery);
        for (const d of dsp.delayRef.delays) {
          d.delayTime.setValueAtTime(val, t);
        }
      }
      if (dlp!.feedbackInterpolation) {
        dsp.delayRef.fbGain.gain.setValueAtTime(
          evalModulation(dlp!.feedbackInterpolation, elapsed, delayFbEvery), t);
      }
      if (dlp!.dryWetInterpolation) {
        const w = clamp01(evalModulation(dlp!.dryWetInterpolation, elapsed, delayDWEvery));
        dsp.delayRef.wet.gain.setValueAtTime(w, t);
        dsp.delayRef.dry.gain.setValueAtTime(1 - w, t);
      }
    }

    // Reverb automation
    if (hasReverbInterp && dsp.reverbRef) {
      const w = clamp01(evalModulation(rp!.dryWetInterpolation!, elapsed, reverbDWEvery));
      dsp.reverbRef.wet.gain.setValueAtTime(w, t);
      dsp.reverbRef.dry.gain.setValueAtTime(1 - w, t);
    }

    // EQ automation (0-1 → -12dB to +12dB)
    if (hasEqInterp && dsp.eqRef) {
      if (eq!.lowGainInterpolation) {
        dsp.eqRef.low.gain.setValueAtTime(
          mapEQGain(evalModulation(eq!.lowGainInterpolation, elapsed, eqLowEvery)), t);
      }
      if (eq!.midGainInterpolation) {
        dsp.eqRef.mid.gain.setValueAtTime(
          mapEQGain(evalModulation(eq!.midGainInterpolation, elapsed, eqMidEvery)), t);
      }
      if (eq!.highGainInterpolation) {
        dsp.eqRef.high.gain.setValueAtTime(
          mapEQGain(evalModulation(eq!.highGainInterpolation, elapsed, eqHighEvery)), t);
      }
    }
  }
}

// ── Spatial: wander position scheduling with noise ──────────

function computeWanderPosition(
  stmt: Statement,
  elapsed: number,
  wanderSpeed: number,
  seed: number,
): { x: number; y: number; z: number } {
  const px1 = seed * 1.0, px2 = seed * 2.3;
  const py1 = seed * 3.7, py2 = seed * 0.5;
  const pz1 = seed * 1.3, pz2 = seed * 4.2;

  const t = elapsed * wanderSpeed;

  let nx = (Math.sin(t + px1) + Math.sin(t * 1.3 + px2) + Math.sin(t * 0.7 + px1 * 0.3)) / 6 + 0.5;
  let ny = (Math.sin(t * 0.8 + py1) + Math.sin(t * 1.1 + py2) + Math.sin(t * 0.6 + py1 * 0.4)) / 6 + 0.5;
  let nz = (Math.sin(t * 1.2 + pz1) + Math.sin(t * 0.7 + pz2) + Math.sin(t * 0.9 + pz1 * 0.6)) / 6 + 0.5;

  // High-frequency noise perturbation — mirrors live engine
  if (stmt.noise > 0) {
    const ht = elapsed * 3.7;
    const n = stmt.noise * 0.15;
    nx += (Math.sin(ht * 2.3 + px2 * 5) + Math.sin(ht * 3.1 + px1 * 7)) * n;
    ny += (Math.sin(ht * 1.9 + py2 * 5) + Math.sin(ht * 2.7 + py1 * 7)) * n;
    nz += (Math.sin(ht * 2.1 + pz2 * 5) + Math.sin(ht * 3.3 + pz1 * 7)) * n;
  }

  const isWalk = stmt.wanderType === WanderType.Walk;
  return {
    x: stmt.areaMin.x + (stmt.areaMax.x - stmt.areaMin.x) * nx,
    y: isWalk ? 0 : stmt.areaMin.y + (stmt.areaMax.y - stmt.areaMin.y) * ny,
    z: stmt.areaMin.z + (stmt.areaMax.z - stmt.areaMin.z) * nz,
  };
}

function computeTrajectoryPosition(
  stmt: Statement,
  elapsed: number,
  seed: number,
  wanderHz: number,
): { x: number; y: number; z: number } {
  const trajectoryName = stmt.wanderType === WanderType.Custom ? stmt.customTrajectoryName : stmt.wanderType;
  const trajectory = trajectoryName ? getTrajectory(trajectoryName) : undefined;
  if (!trajectory) return computeStaticPosition(stmt);

  const trajectoryPhase = (seed / 1000) % 1;
  const t = (elapsed * wanderHz + trajectoryPhase) % 1;
  const pt = trajectory.evaluate(t);

  const px1 = seed * 1.0, px2 = seed * 2.3;
  const py1 = seed * 3.7, py2 = seed * 0.5;
  const pz1 = seed * 1.3, pz2 = seed * 4.2;

  const minX = stmt.areaMin.x, minY = stmt.areaMin.y, minZ = stmt.areaMin.z;
  const rangeX = stmt.areaMax.x - minX;
  const rangeY = stmt.areaMax.y - minY;
  const rangeZ = stmt.areaMax.z - minZ;

  if (stmt.noise > 0) {
    const n = stmt.noise * 0.5;
    const nt = elapsed * 0.7;
    const nx = (Math.sin(nt + px1) + Math.sin(nt * 1.7 + px2)) * n;
    const ny = (Math.sin(nt * 0.9 + py1) + Math.sin(nt * 1.4 + py2)) * n;
    const nz = (Math.sin(nt * 1.1 + pz1) + Math.sin(nt * 1.6 + pz2)) * n;
    return {
      x: minX + rangeX * (pt.x + nx),
      y: minY + rangeY * (pt.y + ny),
      z: minZ + rangeZ * (pt.z + nz),
    };
  }

  return {
    x: minX + rangeX * pt.x,
    y: minY + rangeY * pt.y,
    z: minZ + rangeZ * pt.z,
  };
}

// ── Panner position scheduling ──────────────────────────────

function scheduleTrajectoryPositions(
  panner: PannerNode,
  stmt: Statement,
  startTime: number,
  endTime: number,
  seed: number,
  wanderHz: number,
): void {
  for (let t = startTime; t < endTime; t += AUTOMATION_STEP) {
    const elapsed = t - startTime;
    const pos = computeTrajectoryPosition(stmt, elapsed, seed, wanderHz);
    panner.positionX.setValueAtTime(pos.x, t);
    panner.positionY.setValueAtTime(pos.y, t);
    panner.positionZ.setValueAtTime(pos.z, t);
  }
}

function scheduleWanderPositions(
  panner: PannerNode,
  stmt: Statement,
  startTime: number,
  endTime: number,
  seed: number,
  wanderHz: number,
): void {
  const wanderSpeed = wanderHz * 0.01 * 2 * Math.PI;

  for (let t = startTime; t < endTime; t += AUTOMATION_STEP) {
    const elapsed = t - startTime;
    const pos = computeWanderPosition(stmt, elapsed, wanderSpeed, seed);
    panner.positionX.setValueAtTime(pos.x, t);
    panner.positionY.setValueAtTime(pos.y, t);
    panner.positionZ.setValueAtTime(pos.z, t);
  }
}

// ── Ambisonic position scheduling ───────────────────────────

function scheduleAmbisonicTrajectory(
  _ctx: OfflineAudioContext,
  wGain: GainNode, yGain: GainNode, zGain: GainNode, xGain: GainNode,
  stmt: Statement,
  startTime: number,
  endTime: number,
  seed: number,
  wanderHz: number,
): void {
  for (let t = startTime; t < endTime; t += AUTOMATION_STEP) {
    const elapsed = t - startTime;
    const pos = computeTrajectoryPosition(stmt, elapsed, seed, wanderHz);
    const gains = computeFOAGains(pos.x, pos.y, pos.z);
    const dist = Math.sqrt(pos.x * pos.x + pos.y * pos.y + pos.z * pos.z);
    const atten = distanceAttenuation(dist, 1, 50, 2);

    wGain.gain.setValueAtTime(gains.w * atten, t);
    yGain.gain.setValueAtTime(gains.y * atten, t);
    zGain.gain.setValueAtTime(gains.z * atten, t);
    xGain.gain.setValueAtTime(gains.x * atten, t);
  }
}

function scheduleAmbisonicWander(
  _ctx: OfflineAudioContext,
  wGain: GainNode, yGain: GainNode, zGain: GainNode, xGain: GainNode,
  stmt: Statement,
  startTime: number,
  endTime: number,
  seed: number,
  wanderHz: number,
): void {
  const wanderSpeed = wanderHz * 0.01 * 2 * Math.PI;

  for (let t = startTime; t < endTime; t += AUTOMATION_STEP) {
    const elapsed = t - startTime;
    const pos = computeWanderPosition(stmt, elapsed, wanderSpeed, seed);
    const gains = computeFOAGains(pos.x, pos.y, pos.z);
    const dist = Math.sqrt(pos.x * pos.x + pos.y * pos.y + pos.z * pos.z);
    const atten = distanceAttenuation(dist, 1, 50, 2);

    wGain.gain.setValueAtTime(gains.w * atten, t);
    yGain.gain.setValueAtTime(gains.y * atten, t);
    zGain.gain.setValueAtTime(gains.z * atten, t);
    xGain.gain.setValueAtTime(gains.x * atten, t);
  }
}

// ── Helpers ─────────────────────────────────────────────────

function resolveBuffer(buffers: Map<string, AudioBuffer>, clip: string): AudioBuffer | undefined {
  const resolved = pathFor(clip);
  return buffers.get(resolved) ?? buffers.get(clip);
}

function computeStartTimes(
  stmt: Statement,
  firstStart: number,
  totalDuration: number,
  _bufferDuration: number,
): number[] {
  const times: number[] = [firstStart];

  if (!stmt.every.isNull) {
    // Sample interval once and reuse — matches live engine behavior
    const interval = stmt.every.sample();
    if (interval > 0) {
      let t = firstStart + interval;
      while (t < totalDuration) {
        times.push(t);
        t += interval;
      }
    }
  }

  return times;
}

function computeVoiceDuration(
  stmt: Statement,
  bufferDuration: number,
  remainingTime: number,
): number {
  if (!stmt.duration.isNull) {
    return Math.min(stmt.duration.sample(), remainingTime);
  }
  if (!stmt.end.isNull) {
    return Math.min(stmt.end.sample() - stmt.start.sample(), remainingTime);
  }
  // Loops and persistent voices play until end of composition
  if (stmt.kind === 'loop' || stmt.persistent) {
    return remainingTime;
  }
  return Math.min(bufferDuration, remainingTime);
}

function computeStaticPosition(stmt: Statement): { x: number; y: number; z: number } {
  if (stmt.wanderType === WanderType.None) {
    return {
      x: (stmt.areaMin.x + stmt.areaMax.x) / 2,
      y: (stmt.areaMin.y + stmt.areaMax.y) / 2,
      z: (stmt.areaMin.z + stmt.areaMax.z) / 2,
    };
  }

  if (stmt.wanderType === WanderType.Fixed) {
    return { x: stmt.areaMin.x, y: stmt.areaMin.y, z: stmt.areaMin.z };
  }

  return {
    x: (stmt.areaMin.x + stmt.areaMax.x) / 2,
    y: (stmt.areaMin.y + stmt.areaMax.y) / 2,
    z: (stmt.areaMin.z + stmt.areaMax.z) / 2,
  };
}

function applyFades(
  gain: GainNode,
  stmt: Statement,
  startTime: number,
  bufferDuration: number,
  totalDuration: number,
): void {
  const volume = stmt.volume.sample();

  // Fade in (overrides the micro-fade)
  if (!stmt.fadeIn.isNull) {
    const fadeIn = stmt.fadeIn.sample();
    if (fadeIn > 0) {
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(volume, startTime + fadeIn);
    }
  }

  // Fade out
  if (!stmt.fadeOut.isNull) {
    const fadeOut = stmt.fadeOut.sample();
    if (fadeOut > 0) {
      const voiceDur = computeVoiceDuration(stmt, bufferDuration, totalDuration - startTime);
      const fadeStart = startTime + voiceDur - fadeOut;
      if (fadeStart > startTime) {
        gain.gain.setValueAtTime(volume, fadeStart);
        gain.gain.linearRampToValueAtTime(0, startTime + voiceDur);
      }
    }
  }
}
