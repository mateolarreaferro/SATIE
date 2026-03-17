/**
 * Offline audio renderer for Satie compositions.
 *
 * Renders a Satie script to an AudioBuffer using OfflineAudioContext.
 * Supports three modes:
 *   - stereo: 2ch with equalpower panning
 *   - binaural: 2ch with HRTF panning
 *   - ambisonic-foa: 4ch First-Order Ambisonics (AmbiX: W, Y, Z, X)
 */

import { parse } from '../core/SatieParser';
import { Statement, WanderType, isTrajectoryWanderType } from '../core/Statement';
import { buildDSPChain, destroyDSPChain } from '../dsp/DSPChain';
import { getTrajectory } from '../spatial/Trajectories';
import { computeFOAGains, distanceAttenuation } from './AmbisonicEncoder';

export type RenderMode = 'stereo' | 'binaural' | 'ambisonic-foa';

export interface RenderOptions {
  script: string;
  sampleBuffers: Map<string, ArrayBuffer>;
  duration: number;
  sampleRate?: number;
  mode: RenderMode;
}

export interface RenderProgress {
  phase: 'parsing' | 'decoding' | 'rendering' | 'done';
  progress: number; // 0-1
}

/**
 * Render a Satie script offline to an AudioBuffer.
 */
export async function renderOffline(
  options: RenderOptions,
  onProgress?: (p: RenderProgress) => void,
): Promise<AudioBuffer> {
  const { script, sampleBuffers, duration, mode } = options;
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

  // Decode all referenced audio buffers
  const decodedBuffers = new Map<string, AudioBuffer>();
  const bufferEntries = Array.from(sampleBuffers.entries());

  for (let i = 0; i < bufferEntries.length; i++) {
    const [name, arrayBuffer] = bufferEntries[i];
    try {
      // decodeAudioData consumes the buffer, so we need to copy it
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
  if (mode === 'ambisonic-foa') {
    renderAmbisonicFOA(offlineCtx, statements, decodedBuffers, duration);
  } else {
    renderStereoOrBinaural(offlineCtx, statements, decodedBuffers, duration, mode);
  }

  onProgress?.({ phase: 'rendering', progress: 0.5 });

  // Render
  const result = await offlineCtx.startRendering();

  onProgress?.({ phase: 'done', progress: 1 });

  return result;
}

// ── Stereo / Binaural rendering ─────────────────────────────

function renderStereoOrBinaural(
  ctx: OfflineAudioContext,
  statements: Statement[],
  buffers: Map<string, AudioBuffer>,
  duration: number,
  mode: RenderMode,
): void {
  const masterGain = ctx.createGain();
  masterGain.connect(ctx.destination);

  for (const stmt of statements) {
    if (stmt.mute) continue;

    const audioBuffer = buffers.get(stmt.clip);
    if (!audioBuffer) {
      console.warn(`[OfflineRenderer] Missing buffer for "${stmt.clip}"`);
      continue;
    }

    const startTime = stmt.start.sample();
    const volume = stmt.volume.sample();

    // Calculate repetitions based on 'every' and duration
    const times = computeStartTimes(stmt, startTime, duration, audioBuffer.duration);

    for (const t of times) {
      if (t >= duration) break;

      // Source
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.playbackRate.value = stmt.pitch.sample();
      if (stmt.kind === 'loop') source.loop = true;

      // Gain
      const gain = ctx.createGain();
      gain.gain.value = volume;

      // Fade in/out
      applyFades(gain, stmt, t, audioBuffer.duration, duration);

      // Panner
      const panner = ctx.createPanner();
      panner.panningModel = mode === 'binaural' ? 'HRTF' : 'equalpower';
      panner.distanceModel = 'inverse';
      panner.refDistance = 1;
      panner.maxDistance = 100;
      panner.rolloffFactor = 1;

      // Set position
      const pos = computeStaticPosition(stmt);
      panner.positionX.setValueAtTime(pos.x, 0);
      panner.positionY.setValueAtTime(pos.y, 0);
      panner.positionZ.setValueAtTime(pos.z, 0);

      // Schedule trajectory position changes if applicable
      if (isTrajectoryWanderType(stmt.wanderType) || stmt.wanderType === WanderType.Walk || stmt.wanderType === WanderType.Fly) {
        scheduleTrajectoryPositions(panner, stmt, t, duration);
      }

      // DSP chain
      const dsp = buildDSPChain(ctx as unknown as AudioContext, {
        filter: stmt.filterParams,
        distortion: stmt.distortionParams,
        delay: stmt.delayParams,
        reverb: stmt.reverbParams,
        eq: stmt.eqParams,
      });

      // Connect: source → gain → [DSP] → panner → master
      source.connect(gain);
      if (dsp) {
        gain.connect(dsp.input);
        dsp.output.connect(panner);
      } else {
        gain.connect(panner);
      }
      panner.connect(masterGain);

      // Schedule
      const voiceDuration = computeVoiceDuration(stmt, audioBuffer.duration, duration - t);
      source.start(t);
      if (!stmt.persistent && stmt.kind !== 'loop') {
        source.stop(t + voiceDuration);
      } else if (stmt.kind === 'loop') {
        source.stop(t + voiceDuration);
      }
    }
  }
}

// ── Ambisonic FOA rendering ─────────────────────────────────

function renderAmbisonicFOA(
  ctx: OfflineAudioContext,
  statements: Statement[],
  buffers: Map<string, AudioBuffer>,
  duration: number,
): void {
  // 4-channel merger: W(0), Y(1), Z(2), X(3)
  const merger = ctx.createChannelMerger(4);
  merger.connect(ctx.destination);

  for (const stmt of statements) {
    if (stmt.mute) continue;

    const audioBuffer = buffers.get(stmt.clip);
    if (!audioBuffer) continue;

    const startTime = stmt.start.sample();
    const volume = stmt.volume.sample();
    const times = computeStartTimes(stmt, startTime, duration, audioBuffer.duration);

    for (const t of times) {
      if (t >= duration) break;

      // Source
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.playbackRate.value = stmt.pitch.sample();
      if (stmt.kind === 'loop') source.loop = true;

      // Volume gain
      const gain = ctx.createGain();
      gain.gain.value = volume;
      applyFades(gain, stmt, t, audioBuffer.duration, duration);

      // DSP chain
      const dsp = buildDSPChain(ctx as unknown as AudioContext, {
        filter: stmt.filterParams,
        distortion: stmt.distortionParams,
        delay: stmt.delayParams,
        reverb: stmt.reverbParams,
        eq: stmt.eqParams,
      });

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
      const atten = distanceAttenuation(dist);

      const wGain = ctx.createGain();
      const yGain = ctx.createGain();
      const zGain = ctx.createGain();
      const xGain = ctx.createGain();

      wGain.gain.value = gains.w * atten;
      yGain.gain.value = gains.y * atten;
      zGain.gain.value = gains.z * atten;
      xGain.gain.value = gains.x * atten;

      dspOut.connect(wGain);
      dspOut.connect(yGain);
      dspOut.connect(zGain);
      dspOut.connect(xGain);

      wGain.connect(merger, 0, 0);
      yGain.connect(merger, 0, 1);
      zGain.connect(merger, 0, 2);
      xGain.connect(merger, 0, 3);

      // Schedule trajectory-based gain automation for moving sources
      if (isTrajectoryWanderType(stmt.wanderType) || stmt.wanderType === WanderType.Walk || stmt.wanderType === WanderType.Fly) {
        scheduleAmbisonicTrajectory(ctx, wGain, yGain, zGain, xGain, stmt, t, duration);
      }

      // Schedule
      const voiceDuration = computeVoiceDuration(stmt, audioBuffer.duration, duration - t);
      source.start(t);
      source.stop(t + voiceDuration);
    }
  }
}

// ── Helpers ─────────────────────────────────────────────────

function computeStartTimes(
  stmt: Statement,
  firstStart: number,
  totalDuration: number,
  bufferDuration: number,
): number[] {
  const times: number[] = [firstStart];

  if (!stmt.every.isNull) {
    const interval = stmt.every.sample();
    if (interval > 0) {
      let t = firstStart + interval;
      while (t < totalDuration) {
        times.push(t);
        t += stmt.every.sample(); // re-sample for ranges
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
  if (stmt.kind === 'loop') {
    // Loops play until next event or end of composition
    if (!stmt.every.isNull) {
      return Math.min(stmt.every.sample(), remainingTime);
    }
    return remainingTime;
  }
  return Math.min(bufferDuration, remainingTime);
}

function computeStaticPosition(stmt: Statement): { x: number; y: number; z: number } {
  // Midpoint of area bounds, or (0, 0, 0) if no spatial
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

  // For moving sources, return the center of the movement area
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
  const volume = gain.gain.value;

  // Fade in
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

/**
 * Schedule panner position changes along a trajectory for stereo/binaural mode.
 * Uses setValueAtTime at 30fps intervals.
 */
function scheduleTrajectoryPositions(
  panner: PannerNode,
  stmt: Statement,
  startTime: number,
  totalDuration: number,
): void {
  const trajectory = getTrajectoryForStatement(stmt);
  if (!trajectory) return;

  const speed = stmt.wanderHz.sample();
  const fps = 30;
  const step = 1 / fps;
  const endTime = totalDuration;

  for (let t = startTime; t < endTime; t += step) {
    const elapsed = t - startTime;
    const phase = (elapsed * speed) % 1;
    const pos = trajectory.evaluate(phase);

    // Remap from [0,1] to area bounds
    const x = stmt.areaMin.x + pos.x * (stmt.areaMax.x - stmt.areaMin.x);
    const y = stmt.areaMin.y + pos.y * (stmt.areaMax.y - stmt.areaMin.y);
    const z = stmt.areaMin.z + pos.z * (stmt.areaMax.z - stmt.areaMin.z);

    panner.positionX.setValueAtTime(x, t);
    panner.positionY.setValueAtTime(y, t);
    panner.positionZ.setValueAtTime(z, t);
  }
}

/**
 * Schedule ambisonic gain changes along a trajectory.
 * Updates W, Y, Z, X gain values at 30fps.
 */
function scheduleAmbisonicTrajectory(
  ctx: OfflineAudioContext,
  wGain: GainNode,
  yGain: GainNode,
  zGain: GainNode,
  xGain: GainNode,
  stmt: Statement,
  startTime: number,
  totalDuration: number,
): void {
  const trajectory = getTrajectoryForStatement(stmt);
  if (!trajectory) return;

  const speed = stmt.wanderHz.sample();
  const fps = 30;
  const step = 1 / fps;

  for (let t = startTime; t < totalDuration; t += step) {
    const elapsed = t - startTime;
    const phase = (elapsed * speed) % 1;
    const pos = trajectory.evaluate(phase);

    const x = stmt.areaMin.x + pos.x * (stmt.areaMax.x - stmt.areaMin.x);
    const y = stmt.areaMin.y + pos.y * (stmt.areaMax.y - stmt.areaMin.y);
    const z = stmt.areaMin.z + pos.z * (stmt.areaMax.z - stmt.areaMin.z);

    const gains = computeFOAGains(x, y, z);
    const dist = Math.sqrt(x * x + y * y + z * z);
    const atten = distanceAttenuation(dist);

    wGain.gain.setValueAtTime(gains.w * atten, t);
    yGain.gain.setValueAtTime(gains.y * atten, t);
    zGain.gain.setValueAtTime(gains.z * atten, t);
    xGain.gain.setValueAtTime(gains.x * atten, t);
  }
}

function getTrajectoryForStatement(stmt: Statement): ReturnType<typeof getTrajectory> {
  if (stmt.wanderType === WanderType.Custom && stmt.customTrajectoryName) {
    return getTrajectory(stmt.customTrajectoryName);
  }
  // Map built-in wander types to trajectory names
  const nameMap: Record<string, string> = {
    [WanderType.Spiral]: 'spiral',
    [WanderType.Orbit]: 'orbit',
    [WanderType.Lorenz]: 'lorenz',
  };
  const name = nameMap[stmt.wanderType];
  return name ? getTrajectory(name) : undefined;
}
