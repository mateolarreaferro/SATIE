/**
 * Satie Web Audio Engine — the main runtime.
 * Uses SatieDSPClock + SatieScheduler for sample-accurate event timing.
 *
 * Performance architecture:
 * - Engine tick runs at RAF (~60fps) but only mutates track state objects in-place
 * - React UI is notified at a throttled rate (UI_NOTIFY_HZ) for non-critical state
 * - Three.js reads track state directly via refs (no React re-render needed)
 * - Discrete events (play/stop/script load) notify immediately
 */
import { SatieDSPClock } from './SatieDSPClock';
import { SatieScheduler, AudioEventType, type SatieAudioEvent } from './SatieScheduler';
import { Statement, WanderType, Vec3, isTrajectoryWanderType } from './Statement';
import { getTrajectory } from '../spatial/Trajectories';
import { parse, pathFor } from './SatieParser';
import { InterpolationData, ModulationType, LoopMode } from './InterpolationData';
import { buildDSPChain, destroyDSPChain, makeDistortionCurve, mapCutoff, mapResonance, mapDrive, mapEQGain, mapSpeed, type DSPNodes } from '../dsp/DSPChain';
import { generateAudio, type GenOptions } from '../audio/AudioGen';

// Pre-computed hex lookup table (0-255 → "00"-"ff")
const HEX_LUT: string[] = new Array(256);
for (let i = 0; i < 256; i++) HEX_LUT[i] = i.toString(16).padStart(2, '0');

function toHex(r: number, g: number, b: number): string {
  return '#' + HEX_LUT[r] + HEX_LUT[g] + HEX_LUT[b];
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export interface TrackState {
  key: string;
  statement: Statement;
  sourceNode: AudioBufferSourceNode | null;
  gainNode: GainNode;
  pannerNode: PannerNode;
  position: Vec3;
  isPlaying: boolean;
  startedAt: number;
  volume: number;
  pitch: number;
  color: string;   // resolved hex color
  alpha: number;    // resolved alpha 0-1
  seed: number;     // unique per-voice seed for spatial noise
  wanderHz: number; // sampled once at creation
  dspChain: DSPNodes | null;
  // Pre-cached per-voice values (avoid recomputing every frame)
  _cachedDurations: Map<InterpolationData, number>;
  _staticColorR: number; // pre-parsed static color channel
  _staticColorG: number;
  _staticColorB: number;
  // Pre-computed wander phase offsets
  _px1: number; _px2: number;
  _py1: number; _py2: number;
  _pz1: number; _pz2: number;
  _wanderSpeed: number; // precomputed wanderHz * 0.01 * 2π
  _trajectoryPhase: number; // random phase offset for trajectory modes
}

export interface EngineState {
  isPlaying: boolean;
  currentTime: number;
  tracks: TrackState[];
  statements: Statement[];
  errors: string | null;
}

/** Lightweight snapshot for React UI — only scalar values that change slowly */
export interface EngineUIState {
  isPlaying: boolean;
  currentTime: number;
  trackCount: number;
  statements: Statement[];
  errors: string | null;
  runtimeWarnings: string[];
  mutedIndices: ReadonlySet<number>;
  soloedIndices: ReadonlySet<number>;
}

type EngineListener = (state: EngineState) => void;
type UIListener = (state: EngineUIState) => void;

/** How often to notify React UI listeners (Hz). 3D reads tracks directly. */
const UI_NOTIFY_HZ = 8;
const UI_NOTIFY_INTERVAL = 1000 / UI_NOTIFY_HZ;

/** Spatial position update rate limit — 30fps is plenty for perception */
const SPATIAL_HZ = 30;
const SPATIAL_INTERVAL = 1000 / SPATIAL_HZ;

/**
 * AudioParam smoothing time constant (seconds).
 * Used with setTargetAtTime for gain/pitch/DSP parameter changes.
 * After ~4τ (28ms) the value reaches 98% of target — fast enough to feel
 * instantaneous but smooth enough to avoid zipper noise.
 */
const PARAM_SMOOTHING = 0.007;

export class SatieEngine {
  private ctx: AudioContext;
  private clock: SatieDSPClock;
  private scheduler: SatieScheduler;
  private masterGain: GainNode;
  private limiter: DynamicsCompressorNode;

  private tracks: Map<string, TrackState> = new Map();
  /** Shared array updated in-place. Three.js reads this directly via ref. */
  private _tracksArray: TrackState[] = [];
  private _tracksArrayDirty = true;
  private audioBuffers: Map<string, AudioBuffer> = new Map();
  private statements: Statement[] = [];
  private errors: string | null = null;

  private animFrameId: number | null = null;
  private listeners: Set<EngineListener> = new Set();
  private uiListeners: Set<UIListener> = new Set();

  private _isPlaying: boolean = false;
  private _lastUINotify: number = 0;
  private _lastSpatialUpdate: number = 0;

  /** Runtime warnings (missing samples, generation failures, etc.) */
  private _runtimeWarnings: string[] = [];
  private _runtimeWarningsMax = 20;

  /** Runtime mixer state (independent of parsed mute/solo) */
  private _mutedIndices: Set<number> = new Set();
  private _soloedIndices: Set<number> = new Set();

  /** Callback for resolving missing audio buffers (e.g. community samples). */
  onMissingBuffer: ((clipName: string) => Promise<ArrayBuffer | null>) | null = null;

  /**
   * Callback to search community samples by a gen prompt (e.g. "gentle rain").
   * Returns an ArrayBuffer if a matching community sample is found.
   */
  onSearchCommunity: ((prompt: string) => Promise<ArrayBuffer | null>) | null = null;

  /** When true, try community samples before calling ElevenLabs for gen statements. */
  preferCommunitySamples = false;

  constructor() {
    this.ctx = new AudioContext();
    this.clock = new SatieDSPClock(this.ctx);
    this.scheduler = new SatieScheduler(this.clock);
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.5; // -6 dB headroom before limiter

    // Master limiter — brick-wall prevents clipping when many voices overlap
    this.limiter = this.ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -2;   // start limiting at -2 dB
    this.limiter.knee.value = 0;         // hard knee for true brick-wall
    this.limiter.ratio.value = 20;       // near-brick-wall ratio
    this.limiter.attack.value = 0.0005;  // 0.5ms attack — catch transients before they clip
    this.limiter.release.value = 0.05;   // 50ms release for transparency
    this.masterGain.connect(this.limiter);
    this.limiter.connect(this.ctx.destination);
  }

  get audioContext(): AudioContext { return this.ctx; }
  get isPlaying(): boolean { return this._isPlaying; }
  get currentTime(): number { return this.clock.currentTime; }

  /** Get all decoded audio buffers (for offline export). */
  getAudioBuffers(): ReadonlyMap<string, AudioBuffer> { return this.audioBuffers; }

  /** Sync the AudioListener to the camera/observer position (smoothed to avoid artifacts). */
  setListenerPosition(x: number, y: number, z: number): void {
    const l = this.ctx.listener;
    const t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(x, t, 0.010);
      l.positionY.setTargetAtTime(y, t, 0.010);
      l.positionZ.setTargetAtTime(z, t, 0.010);
    } else {
      l.setPosition(x, y, z);
    }
  }

  /** Sync the AudioListener orientation (smoothed to avoid artifacts on rapid head turns). */
  setListenerOrientation(fx: number, fy: number, fz: number, ux: number, uy: number, uz: number): void {
    const l = this.ctx.listener;
    const t = this.ctx.currentTime;
    if (l.forwardX) {
      l.forwardX.setTargetAtTime(fx, t, 0.010);
      l.forwardY.setTargetAtTime(fy, t, 0.010);
      l.forwardZ.setTargetAtTime(fz, t, 0.010);
      l.upX.setTargetAtTime(ux, t, 0.010);
      l.upY.setTargetAtTime(uy, t, 0.010);
      l.upZ.setTargetAtTime(uz, t, 0.010);
    } else {
      l.setOrientation(fx, fy, fz, ux, uy, uz);
    }
  }

  /** Get the shared tracks array. Updated in-place — no allocation per frame. */
  getTracksArray(): TrackState[] {
    if (this._tracksArrayDirty) {
      this._tracksArray = Array.from(this.tracks.values());
      this._tracksArrayDirty = false;
    }
    return this._tracksArray;
  }

  subscribe(listener: EngineListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Subscribe to throttled UI-only updates (currentTime, trackCount). */
  subscribeUI(listener: UIListener): () => void {
    this.uiListeners.add(listener);
    return () => this.uiListeners.delete(listener);
  }

  private notify(): void {
    const tracks = this.getTracksArray();
    const state: EngineState = {
      isPlaying: this._isPlaying,
      currentTime: this.clock.currentTime,
      tracks,
      statements: this.statements,
      errors: this.errors,
    };
    for (const listener of this.listeners) listener(state);
    // Also push to UI listeners on discrete events
    this.notifyUI();
  }

  private notifyUI(): void {
    const uiState: EngineUIState = {
      isPlaying: this._isPlaying,
      currentTime: this.clock.currentTime,
      trackCount: this.tracks.size,
      statements: this.statements,
      errors: this.errors,
      runtimeWarnings: this._runtimeWarnings,
      mutedIndices: this._mutedIndices,
      soloedIndices: this._soloedIndices,
    };
    for (const listener of this.uiListeners) listener(uiState);
  }

  /** Add a runtime warning (surfaced to editor UI). */
  private addRuntimeWarning(msg: string): void {
    // Avoid duplicates
    if (this._runtimeWarnings.includes(msg)) return;
    this._runtimeWarnings.push(msg);
    if (this._runtimeWarnings.length > this._runtimeWarningsMax) {
      this._runtimeWarnings.shift();
    }
  }

  /** Clear runtime warnings (called on play/stop). */
  private clearRuntimeWarnings(): void {
    this._runtimeWarnings = [];
  }

  // ── Audio loading ──

  async loadAudioFile(name: string, url: string): Promise<void> {
    if (this.audioBuffers.has(name)) return;
    try {
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
      this.audioBuffers.set(name, audioBuffer);
    } catch (e: any) {
      this.addRuntimeWarning(`Failed to load audio: ${name} (${e.message ?? 'unknown error'})`);
    }
  }

  async loadAudioBuffer(name: string, data: ArrayBuffer): Promise<void> {
    const audioBuffer = await this.ctx.decodeAudioData(data.slice(0));
    this.audioBuffers.set(name, audioBuffer);
  }

  getLoadedAudioNames(): string[] {
    return Array.from(this.audioBuffers.keys());
  }

  // ── Script / transport ──

  loadScript(script: string): void {
    // Snapshot existing gen prompt → audio buffer mappings before re-parse
    const prevGenBuffers = new Map<string, AudioBuffer>();
    for (const stmt of this.statements) {
      if (!stmt.isGenerated || !stmt.genPrompt) continue;
      const cp = pathFor(stmt.clip);
      const buf = this.audioBuffers.get(cp) ?? this.audioBuffers.get(stmt.clip);
      if (buf) prevGenBuffers.set(stmt.genPrompt, buf);
    }

    try {
      this.statements = parse(script);
      this.errors = null;
    } catch (e: any) {
      this.errors = e.message;
      this.statements = [];
    }

    // Carry forward audio buffers for gen voices whose prompts match previous ones,
    // even if clip paths changed (e.g. AI reworded the script but kept same sounds)
    for (const stmt of this.statements) {
      if (!stmt.isGenerated || !stmt.genPrompt) continue;
      const cp = pathFor(stmt.clip);
      if (this.audioBuffers.has(cp) || this.audioBuffers.has(stmt.clip)) continue;

      // Exact match first
      let existing = prevGenBuffers.get(stmt.genPrompt);

      // Fuzzy match: if the new prompt contains an old prompt (or vice versa), reuse it
      if (!existing) {
        const newWords = stmt.genPrompt.toLowerCase();
        for (const [oldPrompt, buf] of prevGenBuffers) {
          const oldWords = oldPrompt.toLowerCase();
          if (newWords.includes(oldWords) || oldWords.includes(newWords)) {
            existing = buf;
            break;
          }
        }
      }

      if (existing) {
        this.audioBuffers.set(cp, existing);
      }
    }

    // If playing, restart with new statements
    if (this._isPlaying) {
      this.teardownAll();
      this.scheduleAll();
    }

    this.notify();
  }

  async play(): Promise<void> {
    if (this._isPlaying) return;
    if (this.ctx.state === 'suspended') await this.ctx.resume();

    this.clearRuntimeWarnings();
    this._generationDisabled = false;
    this._isPlaying = true;
    this.clock.start();
    this.scheduler.reset();

    // Eager pre-generation: kick off all gen audio requests in parallel
    this.preGenerateAll();

    this.scheduleAll();
    this.tick();
    this.notify();
  }

  stop(): void {
    this._isPlaying = false;

    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }

    this.teardownAll();
    this.notify();
  }

  setMasterVolume(vol: number): void {
    this.masterGain.gain.setValueAtTime(vol, this.ctx.currentTime);
  }

  // ── Mixer: runtime mute/solo ──

  toggleMute(statementIndex: number): void {
    // Create new Set so React memo detects the reference change
    const next = new Set(this._mutedIndices);
    if (next.has(statementIndex)) {
      next.delete(statementIndex);
    } else {
      next.add(statementIndex);
    }
    this._mutedIndices = next;
    this.applyMixerState();
    this.notifyUI();
  }

  toggleSolo(statementIndex: number): void {
    const next = new Set(this._soloedIndices);
    if (next.has(statementIndex)) {
      next.delete(statementIndex);
    } else {
      next.add(statementIndex);
    }
    this._soloedIndices = next;
    this.applyMixerState();
    this.notifyUI();
  }

  get mutedIndices(): ReadonlySet<number> { return this._mutedIndices; }
  get soloedIndices(): ReadonlySet<number> { return this._soloedIndices; }

  /** Check if a track is audible given current mute/solo state. */
  private isTrackAudible(track: TrackState): boolean {
    const parts = track.key.split('_');
    const stmtIndex = parseInt(parts[parts.length - 2], 10);
    if (this._mutedIndices.has(stmtIndex)) return false;
    if (this._soloedIndices.size > 0 && !this._soloedIndices.has(stmtIndex)) return false;
    return true;
  }

  /** Recalculate which tracks are audible based on mute/solo state. */
  private applyMixerState(): void {
    for (const track of this.tracks.values()) {
      const targetGain = this.isTrackAudible(track) ? track.volume : 0;
      track.gainNode.gain.setTargetAtTime(targetGain, this.ctx.currentTime, PARAM_SMOOTHING);
    }
  }

  // ── Internal: schedule all statements ──

  private scheduleAll(): void {
    this.clock.start();
    this.scheduler.reset();

    for (let i = 0; i < this.statements.length; i++) {
      const stmt = this.statements[i];
      if (stmt.mute) continue;

      for (let c = 0; c < stmt.count; c++) {
        const key = `${stmt.clip}_${i}_${c}`;
        const startSeconds = stmt.start.sample();

        this.scheduler.schedule({
          scheduledSample: this.clock.secondsToSamples(startSeconds),
          type: AudioEventType.Callback,
          trackKey: key,
          debugLabel: `create:${stmt.clip}`,
          onExecute: () => this.createVoice(key, stmt),
        });
      }
    }
  }

  private teardownAll(): void {
    this.scheduler.reset();

    for (const track of this.tracks.values()) {
      if (track.sourceNode) {
        try { track.sourceNode.stop(); } catch { /* ok */ }
        try { track.sourceNode.disconnect(); } catch { /* ok */ }
        track.sourceNode = null;
      }
      if (track.dspChain) destroyDSPChain(track.dspChain);
      track.gainNode.disconnect();
      track.pannerNode.disconnect();
    }
    this.tracks.clear();
    this._tracksArrayDirty = true;
  }

  // ── Tick loop ──

  private tick = (): void => {
    if (!this._isPlaying) return;

    const now = performance.now();

    // Process any due scheduler events
    this.scheduler.process();

    // Update continuous track state (spatial, interpolation)
    // Spatial updates are rate-limited; interpolation runs every frame for smoothness
    const doSpatial = now - this._lastSpatialUpdate >= SPATIAL_INTERVAL;
    this.updateTracks(doSpatial);
    if (doSpatial) this._lastSpatialUpdate = now;

    // Throttle React UI notifications
    if (now - this._lastUINotify >= UI_NOTIFY_INTERVAL) {
      this._lastUINotify = now;
      this.notifyUI();
    }

    this.animFrameId = requestAnimationFrame(this.tick);
  };

  // ── Voice lifecycle ──

  private createVoice(key: string, stmt: Statement): void {
    if (!this._isPlaying) return;

    const gainNode = this.ctx.createGain();

    const pannerNode = this.ctx.createPanner();
    pannerNode.panningModel = 'HRTF';
    pannerNode.distanceModel = 'inverse';
    pannerNode.refDistance = 1;
    pannerNode.maxDistance = 50;
    pannerNode.rolloffFactor = 2;
    pannerNode.coneInnerAngle = 360;
    pannerNode.coneOuterAngle = 360;
    pannerNode.coneOuterGain = 0;

    // Use positionX/Y/Z AudioParams instead of deprecated setPosition
    pannerNode.positionX.value = 0;
    pannerNode.positionY.value = 0;
    pannerNode.positionZ.value = 0;

    // Build DSP chain from statement params (native Web Audio nodes — zero JS overhead)
    const dspChain = buildDSPChain(this.ctx, {
      filter: stmt.filterParams,
      distortion: stmt.distortionParams,
      delay: stmt.delayParams,
      reverb: stmt.reverbParams,
      eq: stmt.eqParams,
    });

    // Audio routing: source → gain → [DSP chain] → panner → master
    if (dspChain) {
      gainNode.connect(dspChain.input);
      dspChain.output.connect(pannerNode);
    } else {
      gainNode.connect(pannerNode);
    }
    pannerNode.connect(this.masterGain);

    // Pre-parse static color channels once
    const sc = stmt.staticColor ?? '#1a3a2a';
    const scR = parseInt(sc.substring(1, 3), 16);
    const scG = parseInt(sc.substring(3, 5), 16);
    const scB = parseInt(sc.substring(5, 7), 16);

    const seed = Math.random() * 1000;
    const wanderHz = mapSpeed(stmt.wanderHz.sample());

    const track: TrackState = {
      key,
      statement: stmt,
      sourceNode: null,
      gainNode,
      pannerNode,
      position: { x: 0, y: 0, z: 0 },
      isPlaying: true,
      startedAt: this.clock.currentTime,
      volume: stmt.volume.sample(),
      pitch: stmt.pitch.sample(),
      color: this.sampleInitialColor(stmt),
      alpha: stmt.staticAlpha,
      dspChain,
      seed,
      wanderHz,
      // Pre-cache interpolation durations and ease functions
      _cachedDurations: new Map(),
      _staticColorR: scR,
      _staticColorG: scG,
      _staticColorB: scB,
      // Pre-compute wander phase offsets
      _px1: seed * 1.0,
      _px2: seed * 2.3,
      _py1: seed * 3.7,
      _py2: seed * 0.5,
      _pz1: seed * 1.3,
      _pz2: seed * 4.2,
      _wanderSpeed: wanderHz * 0.01 * 2 * Math.PI,
      _trajectoryPhase: Math.random(),
    };

    // Pre-cache durations for all modulations on this voice
    this.cacheInterpolation(track, stmt.volumeInterpolation);
    this.cacheInterpolation(track, stmt.pitchInterpolation);
    this.cacheInterpolation(track, stmt.groupVolumeModulation);
    this.cacheInterpolation(track, stmt.groupPitchModulation);
    this.cacheInterpolation(track, stmt.colorRedInterpolation);
    this.cacheInterpolation(track, stmt.colorGreenInterpolation);
    this.cacheInterpolation(track, stmt.colorBlueInterpolation);
    this.cacheInterpolation(track, stmt.colorAlphaInterpolation);
    // DSP interpolations
    if (stmt.filterParams) {
      this.cacheInterpolation(track, stmt.filterParams.cutoffInterpolation);
      this.cacheInterpolation(track, stmt.filterParams.resonanceInterpolation);
      this.cacheInterpolation(track, stmt.filterParams.dryWetInterpolation);
    }
    if (stmt.distortionParams) {
      this.cacheInterpolation(track, stmt.distortionParams.driveInterpolation);
      this.cacheInterpolation(track, stmt.distortionParams.dryWetInterpolation);
    }
    if (stmt.delayParams) {
      this.cacheInterpolation(track, stmt.delayParams.timeInterpolation);
      this.cacheInterpolation(track, stmt.delayParams.feedbackInterpolation);
      this.cacheInterpolation(track, stmt.delayParams.dryWetInterpolation);
    }
    if (stmt.reverbParams) {
      this.cacheInterpolation(track, stmt.reverbParams.dryWetInterpolation);
    }
    if (stmt.eqParams) {
      this.cacheInterpolation(track, stmt.eqParams.lowGainInterpolation);
      this.cacheInterpolation(track, stmt.eqParams.midGainInterpolation);
      this.cacheInterpolation(track, stmt.eqParams.highGainInterpolation);
    }

    this.tracks.set(key, track);
    this._tracksArrayDirty = true;

    // Apply mixer mute/solo state to new voice
    if (!this.isTrackAudible(track)) {
      track.gainNode.gain.value = 0;
    }

    // Fire first audio trigger
    this.retriggerAudio(key, stmt);

    // Schedule voice end
    if (!stmt.duration.isNull) {
      const dur = stmt.duration.sample();
      const fadeOut = !stmt.fadeOut.isNull ? stmt.fadeOut.sample() : 0;
      this.scheduler.schedule({
        scheduledSample: this.clock.currentSample + this.clock.secondsToSamples(dur),
        type: AudioEventType.Callback,
        trackKey: key,
        debugLabel: `end:${stmt.clip}`,
        onExecute: () => this.stopTrack(key, fadeOut),
      });
    } else if (!stmt.end.isNull) {
      const endTime = stmt.end.sample();
      const endFade = !stmt.endFade.isNull ? stmt.endFade.sample() : 0;
      this.scheduler.schedule({
        scheduledSample: this.clock.secondsToSamples(endTime),
        type: AudioEventType.Callback,
        trackKey: key,
        debugLabel: `end:${stmt.clip}`,
        onExecute: () => this.stopTrack(key, endFade),
      });
    }
  }

  /** Cache the sampled 'every' duration for a modulation. */
  private cacheInterpolation(track: TrackState, interp: InterpolationData | null): void {
    if (!interp) return;
    track._cachedDurations.set(interp, interp.every.sample());
  }

  // ── Audio clip triggering ──

  private retriggerAudio(key: string, stmt: Statement): void {
    if (!this._isPlaying) return;

    const track = this.tracks.get(key);
    if (!track) return;

    const clipPath = pathFor(stmt.clip);
    const buffer = this.audioBuffers.get(clipPath) ?? this.audioBuffers.get(stmt.clip);

    if (!buffer) {
      // If generation is already in-flight for this clip, don't re-request
      if (this._generationInFlight.has(clipPath)) return;

      if (stmt.isGenerated && stmt.genPrompt) {
        // Community-first: try finding a matching community sample before generating
        if (this.preferCommunitySamples && this.onSearchCommunity) {
          this.communityThenGenerate(key, stmt, clipPath);
        } else {
          this.generateAndRetrigger(key, stmt, clipPath);
        }
        return;
      }
      // Try resolving via onMissingBuffer callback (e.g. community samples)
      if (this.onMissingBuffer) {
        this.resolveAndRetrigger(key, stmt, clipPath);
        return;
      }
      this.addRuntimeWarning(`Audio not loaded: ${stmt.clip}`);
      return;
    }

    if (track.sourceNode) {
      try { track.sourceNode.stop(); } catch { /* ok */ }
      try { track.sourceNode.disconnect(); } catch { /* ok */ }
      track.sourceNode = null;
    }

    const sourceNode = this.ctx.createBufferSource();
    sourceNode.buffer = buffer;
    sourceNode.loop = stmt.kind === 'loop';
    sourceNode.connect(track.gainNode);

    const volume = stmt.volume.sample();
    const pitch = stmt.pitch.sample();
    const now = this.ctx.currentTime;

    // Always start at zero to avoid click, then ramp up
    track.gainNode.gain.setValueAtTime(0, now);
    sourceNode.playbackRate.setValueAtTime(pitch, now);
    track.volume = volume;
    track.pitch = pitch;
    track.sourceNode = sourceNode;

    if (stmt.randomStart) {
      sourceNode.start(0, Math.random() * buffer.duration);
    } else {
      sourceNode.start();
    }

    // Fade in — explicit AudioParam automation (runs on audio thread)
    if (!stmt.fadeIn.isNull) {
      const fadeTime = stmt.fadeIn.sample();
      track.gainNode.gain.linearRampToValueAtTime(volume, now + fadeTime);
    } else {
      // 5ms micro-fade to eliminate click on start
      track.gainNode.gain.linearRampToValueAtTime(volume, now + 0.005);
    }

    // Schedule next retrigger
    if (stmt.kind === 'oneshot' && !stmt.every.isNull) {
      const everySeconds = stmt.every.sample();
      this.scheduler.schedule({
        scheduledSample: this.clock.currentSample + this.clock.secondsToSamples(everySeconds),
        type: AudioEventType.Callback,
        trackKey: key,
        debugLabel: `retrigger:${stmt.clip}`,
        onExecute: () => this.retriggerAudio(key, stmt),
      });
    }

    if (stmt.kind === 'oneshot' && stmt.every.isNull) {
      sourceNode.onended = () => {
        track.isPlaying = false;
        if (track.sourceNode) {
          try { track.sourceNode.disconnect(); } catch { /* ok */ }
          track.sourceNode = null;
        }
        if (track.dspChain) destroyDSPChain(track.dspChain);
        track.gainNode.disconnect();
        track.pannerNode.disconnect();
        this.tracks.delete(key);
        this._tracksArrayDirty = true;
      };
    }
  }

  // ── Async audio generation for gen statements ──

  /** Sample gen options from statement ranges. */
  private sampleGenOptions(stmt: Statement): GenOptions {
    const opts: GenOptions = {};
    if (!stmt.genDuration.isNull) {
      opts.duration = stmt.genDuration.sample();
    } else if (stmt.genLoopable) {
      opts.duration = 10; // loopable default
    }
    if (!stmt.genInfluence.isNull) {
      opts.influence = stmt.genInfluence.sample();
    }
    return opts;
  }

  /** Eagerly pre-generate all gen audio on play(). Doesn't block playback. */
  private preGenerateAll(): void {
    // Reuse the same audio buffer for duplicate gen prompts (e.g. count-multiplied
    // voices like "3 * loop gen wind"). Variation in volume/pitch/position already
    // differentiates them sonically — generating separate ElevenLabs audio for each
    // wastes $0.20-0.40 per duplicate with negligible audible benefit.
    const promptToClip = new Map<string, string>(); // basePrompt → first clipPath
    const promptToPromise = new Map<string, Promise<void>>(); // basePrompt → generation promise

    for (let i = 0; i < this.statements.length; i++) {
      const stmt = this.statements[i];
      if (!stmt.isGenerated || !stmt.genPrompt) continue;

      const clipPath = pathFor(stmt.clip);
      // Skip if already loaded
      if (this.audioBuffers.has(clipPath) || this.audioBuffers.has(stmt.clip)) continue;

      const basePrompt = stmt.genPrompt;

      // If we already queued generation for this prompt, reuse that buffer once ready
      const firstClip = promptToClip.get(basePrompt);
      if (firstClip) {
        const p = promptToPromise.get(basePrompt);
        if (p) {
          p.then(() => {
            const buf = this.audioBuffers.get(firstClip);
            if (buf) this.audioBuffers.set(clipPath, buf);
          });
        }
        continue;
      }

      promptToClip.set(basePrompt, clipPath);

      // Community-first: try community samples before calling ElevenLabs
      if (this.preferCommunitySamples && this.onSearchCommunity) {
        const promise = this.onSearchCommunity(basePrompt)
          .then(async (communityData) => {
            if (communityData) {
              console.log(`[SatieEngine] Community match for "${basePrompt}" → ${clipPath}`);
              const ab = await this.ctx.decodeAudioData(communityData.slice(0));
              this.audioBuffers.set(clipPath, ab);
            } else {
              // No match — fall back to ElevenLabs
              return this.fallbackGenerate(basePrompt, clipPath, stmt);
            }
          })
          .catch(() => this.fallbackGenerate(basePrompt, clipPath, stmt));
        promptToPromise.set(basePrompt, promise);
      } else {
        const promise = new Promise<void>((resolve) => {
          this.fallbackGenerate(basePrompt, clipPath, stmt);
          // fallbackGenerate is fire-and-forget; resolve after the in-flight promise
          const inflight = this._generationInFlight.get(clipPath);
          if (inflight) inflight.then(() => resolve()).catch(() => resolve());
          else resolve();
        });
        promptToPromise.set(basePrompt, promise);
      }
    }
  }

  private fallbackGenerate(prompt: string, clipPath: string, stmt: Statement): void {
    if (this._generationDisabled) return;

    // Deduplicate: skip if already in-flight or already loaded
    if (this._generationInFlight.has(clipPath)) return;
    if (this.audioBuffers.has(clipPath)) return;

    const opts = this.sampleGenOptions(stmt);
    console.log(`[SatieEngine] Generating audio: "${prompt}" → ${clipPath}`);
    const promise = generateAudio(this.ctx, prompt, clipPath, stmt.kind === 'loop', opts)
      .then((audioBuffer) => {
        this.audioBuffers.set(clipPath, audioBuffer);
        return audioBuffer;
      })
      .catch((e: any) => {
        if (e.message?.includes('402') || e.message?.includes('401') ||
            e.message?.includes('credits') || e.message?.includes('Sign in')) {
          this._generationDisabled = true;
        }
        this.addRuntimeWarning(`Audio generation failed: ${e.message}`);
        return null;
      })
      .finally(() => {
        this._generationInFlight.delete(clipPath);
      });

    this._generationInFlight.set(clipPath, promise as Promise<AudioBuffer | null>);
  }

  /** In-flight generation promises keyed by clipPath — prevents duplicate requests */
  private _generationInFlight = new Map<string, Promise<AudioBuffer | null>>();

  /** Set to true when the proxy returns 402 — stops further generation attempts */
  private _generationDisabled = false;

  private async generateAndRetrigger(key: string, stmt: Statement, clipPath: string): Promise<void> {
    // Stop spamming the API if we already know there are no credits
    if (this._generationDisabled) return;

    // If already in-flight for this clipPath, wait for the existing request
    const existing = this._generationInFlight.get(clipPath);
    if (existing) {
      const buf = await existing;
      if (buf && this._isPlaying && this.tracks.has(key)) {
        this.retriggerAudio(key, stmt);
      }
      return;
    }

    const promise = (async (): Promise<AudioBuffer | null> => {
      try {
        const opts = this.sampleGenOptions(stmt);
        const effectivePrompt = stmt.genPrompt!;

        // For variant clips (e.g. _2, _3 from count multiplier), reuse the
        // base clip's buffer instead of generating a separate ElevenLabs call.
        // Volume/pitch/position randomization already differentiates them.
        const variantMatch = clipPath.match(/_(\d+)$/);
        if (variantMatch) {
          const baseClip = clipPath.replace(/_\d+$/, '');
          const baseBuf = this.audioBuffers.get(baseClip);
          if (baseBuf) {
            this.audioBuffers.set(clipPath, baseBuf);
            return baseBuf;
          }
          // If base is in-flight, wait for it
          const baseInFlight = this._generationInFlight.get(baseClip);
          if (baseInFlight) {
            const buf = await baseInFlight;
            if (buf) {
              this.audioBuffers.set(clipPath, buf);
              return buf;
            }
          }
        }

        console.log(`[SatieEngine] Generating audio: "${effectivePrompt}" → ${clipPath}`);
        const audioBuffer = await generateAudio(
          this.ctx,
          effectivePrompt,
          clipPath,
          stmt.kind === 'loop',
          opts,
        );
        this.audioBuffers.set(clipPath, audioBuffer);
        return audioBuffer;
      } catch (e: any) {
        // If 402 (no credits) or 401 (not signed in), stop all future generation
        if (e.message?.includes('402') || e.message?.includes('401') ||
            e.message?.includes('credits') || e.message?.includes('Sign in')) {
          this._generationDisabled = true;
          this.addRuntimeWarning(e.message);
        } else {
          this.addRuntimeWarning(`Audio generation failed for "${stmt.genPrompt}": ${e.message}`);
        }
        return null;
      } finally {
        this._generationInFlight.delete(clipPath);
      }
    })();

    this._generationInFlight.set(clipPath, promise);
    const buf = await promise;

    // Retry playback if still playing
    if (buf && this._isPlaying && this.tracks.has(key)) {
      this.retriggerAudio(key, stmt);
    }
  }

  private async communityThenGenerate(key: string, stmt: Statement, clipPath: string): Promise<void> {
    try {
      const data = await this.onSearchCommunity!(stmt.genPrompt!);
      if (data) {
        console.log(`[SatieEngine] Community match for gen "${stmt.genPrompt}" → ${clipPath}`);
        const audioBuffer = await this.ctx.decodeAudioData(data.slice(0));
        this.audioBuffers.set(clipPath, audioBuffer);
        if (this._isPlaying && this.tracks.has(key)) {
          this.retriggerAudio(key, stmt);
        }
        return;
      }
    } catch { /* community search failed, fall through */ }

    // No community match — fall back to ElevenLabs generation
    this.generateAndRetrigger(key, stmt, clipPath);
  }

  private async resolveAndRetrigger(key: string, stmt: Statement, clipPath: string): Promise<void> {
    if (!this.onMissingBuffer) return;
    try {
      const data = await this.onMissingBuffer(stmt.clip);
      if (!data) {
        this.addRuntimeWarning(`Audio not found: ${stmt.clip}`);
        return;
      }
      const audioBuffer = await this.ctx.decodeAudioData(data.slice(0)); // slice to avoid detach
      this.audioBuffers.set(clipPath, audioBuffer);
      // Retry playback if still playing
      if (this._isPlaying && this.tracks.has(key)) {
        this.retriggerAudio(key, stmt);
      }
    } catch (e: any) {
      this.addRuntimeWarning(`Failed to resolve audio "${stmt.clip}": ${e.message}`);
    }
  }

  // ── Stop a single track ──

  private stopTrack(key: string, fadeOutTime: number = 0): void {
    const track = this.tracks.get(key);
    if (!track) return;

    this.scheduler.cancelTrackEvents(key);

    const cleanup = () => {
      if (track.sourceNode) {
        try { track.sourceNode.stop(); } catch { /* ok */ }
        try { track.sourceNode.disconnect(); } catch { /* ok */ }
        track.sourceNode = null;
      }
      if (track.dspChain) destroyDSPChain(track.dspChain);
      track.gainNode.disconnect();
      track.pannerNode.disconnect();
      this.tracks.delete(key);
      this._tracksArrayDirty = true;
    };

    // Always use at least a 5ms micro-fade to avoid click on stop
    const effectiveFade = Math.max(fadeOutTime, 0.005);
    const now = this.ctx.currentTime;
    track.gainNode.gain.cancelScheduledValues(now);
    track.gainNode.gain.setValueAtTime(track.gainNode.gain.value, now);
    track.gainNode.gain.linearRampToValueAtTime(0, now + effectiveFade);
    this.scheduler.schedule({
      scheduledSample: this.clock.currentSample + this.clock.secondsToSamples(effectiveFade + 0.01),
      type: AudioEventType.Callback,
      trackKey: key + '_cleanup',
      debugLabel: `cleanup:${key}`,
      onExecute: cleanup,
    });
  }

  // ── Continuous per-frame updates ──

  private updateTracks(doSpatial: boolean): void {
    const now = this.clock.currentTime;
    const ctxTime = this.ctx.currentTime;

    for (const track of this.tracks.values()) {
      const stmt = track.statement;
      const elapsed = now - track.startedAt;

      // Volume modulation — multiply per-voice with group modulation
      if (stmt.volumeInterpolation || stmt.groupVolumeModulation) {
        let val = stmt.volumeInterpolation
          ? this.evalInterpCached(track, stmt.volumeInterpolation, elapsed)
          : track.volume;
        if (stmt.groupVolumeModulation) {
          val *= this.evalInterpCached(track, stmt.groupVolumeModulation, elapsed);
        }
        track.volume = val;
        const audibleVal = this.isTrackAudible(track) ? val : 0;
        track.gainNode.gain.setTargetAtTime(audibleVal, ctxTime, PARAM_SMOOTHING);
      }

      // Pitch modulation — multiply per-voice with group modulation
      if ((stmt.pitchInterpolation || stmt.groupPitchModulation) && track.sourceNode) {
        let val = stmt.pitchInterpolation
          ? this.evalInterpCached(track, stmt.pitchInterpolation, elapsed)
          : track.pitch;
        if (stmt.groupPitchModulation) {
          val *= this.evalInterpCached(track, stmt.groupPitchModulation, elapsed);
        }
        track.sourceNode.playbackRate.setTargetAtTime(val, ctxTime, PARAM_SMOOTHING);
        track.pitch = val;
      }

      // Spatial position — rate-limited to 30fps with smoothing
      if (doSpatial && stmt.wanderType !== WanderType.None) {
        if (isTrajectoryWanderType(stmt.wanderType)) {
          this.calculateTrajectoryPositionInPlace(track, stmt, elapsed);
        } else {
          this.calculateWanderPositionInPlace(track, stmt, elapsed);
        }
        // Smooth position transitions with 20ms time constant to avoid stepping artifacts
        track.pannerNode.positionX.setTargetAtTime(track.position.x, ctxTime, 0.020);
        track.pannerNode.positionY.setTargetAtTime(track.position.y, ctxTime, 0.020);
        track.pannerNode.positionZ.setTargetAtTime(track.position.z, ctxTime, 0.020);
      }

      // Interpolated color — only compute when interpolation exists
      if (stmt.colorRedInterpolation || stmt.colorGreenInterpolation || stmt.colorBlueInterpolation) {
        const r = stmt.colorRedInterpolation
          ? clamp255(Math.round(this.evalInterpCached(track, stmt.colorRedInterpolation, elapsed) * 255))
          : track._staticColorR;
        const g = stmt.colorGreenInterpolation
          ? clamp255(Math.round(this.evalInterpCached(track, stmt.colorGreenInterpolation, elapsed) * 255))
          : track._staticColorG;
        const b = stmt.colorBlueInterpolation
          ? clamp255(Math.round(this.evalInterpCached(track, stmt.colorBlueInterpolation, elapsed) * 255))
          : track._staticColorB;
        track.color = toHex(r, g, b);
      }

      // Interpolated alpha
      if (stmt.colorAlphaInterpolation) {
        track.alpha = clamp01(this.evalInterpCached(track, stmt.colorAlphaInterpolation, elapsed));
      }

      // DSP parameter interpolation
      if (track.dspChain) {
        this.updateDSPInterpolations(track, stmt, elapsed, ctxTime, doSpatial);
      }
    }
  }

  // ── DSP interpolation (per-frame for AudioParams, rate-limited for expensive ops) ──

  private updateDSPInterpolations(track: TrackState, stmt: Statement, elapsed: number, ctxTime: number, doSpatial: boolean): void {
    const dsp = track.dspChain!;

    // Filter (values are 0-1 normalized, map to real ranges)
    if (stmt.filterParams && dsp.filterRef) {
      const fp = stmt.filterParams;
      if (fp.cutoffInterpolation) {
        dsp.filterRef.filter.frequency.setTargetAtTime(
          mapCutoff(this.evalInterpCached(track, fp.cutoffInterpolation, elapsed)), ctxTime, PARAM_SMOOTHING);
      }
      if (fp.resonanceInterpolation) {
        dsp.filterRef.filter.Q.setTargetAtTime(
          mapResonance(this.evalInterpCached(track, fp.resonanceInterpolation, elapsed)), ctxTime, PARAM_SMOOTHING);
      }
      if (fp.dryWetInterpolation) {
        const w = clamp01(this.evalInterpCached(track, fp.dryWetInterpolation, elapsed));
        dsp.filterRef.wet.gain.setTargetAtTime(w, ctxTime, PARAM_SMOOTHING);
        dsp.filterRef.dry.gain.setTargetAtTime(1 - w, ctxTime, PARAM_SMOOTHING);
      }
    }

    // Distortion — drive regenerates curve at spatial rate (30fps) to avoid excess cost
    if (stmt.distortionParams && dsp.distortionRef) {
      const dp = stmt.distortionParams;
      if (dp.driveInterpolation && doSpatial) {
        const drive = mapDrive(this.evalInterpCached(track, dp.driveInterpolation, elapsed));
        dsp.distortionRef.shaper.curve = makeDistortionCurve(
          dsp.distortionRef.mode, drive) as unknown as Float32Array<ArrayBuffer>;
      }
      if (dp.dryWetInterpolation) {
        const w = clamp01(this.evalInterpCached(track, dp.dryWetInterpolation, elapsed));
        dsp.distortionRef.wet.gain.setTargetAtTime(w, ctxTime, PARAM_SMOOTHING);
        dsp.distortionRef.dry.gain.setTargetAtTime(1 - w, ctxTime, PARAM_SMOOTHING);
      }
    }

    // Delay
    if (stmt.delayParams && dsp.delayRef) {
      const dlp = stmt.delayParams;
      if (dlp.timeInterpolation) {
        const t = this.evalInterpCached(track, dlp.timeInterpolation, elapsed);
        for (const d of dsp.delayRef.delays) {
          d.delayTime.setTargetAtTime(t, ctxTime, PARAM_SMOOTHING);
        }
      }
      if (dlp.feedbackInterpolation) {
        dsp.delayRef.fbGain.gain.setTargetAtTime(
          this.evalInterpCached(track, dlp.feedbackInterpolation, elapsed), ctxTime, PARAM_SMOOTHING);
      }
      if (dlp.dryWetInterpolation) {
        const w = clamp01(this.evalInterpCached(track, dlp.dryWetInterpolation, elapsed));
        dsp.delayRef.wet.gain.setTargetAtTime(w, ctxTime, PARAM_SMOOTHING);
        dsp.delayRef.dry.gain.setTargetAtTime(1 - w, ctxTime, PARAM_SMOOTHING);
      }
    }

    // Reverb — only dryWet (roomSize/damping require IR regeneration, too expensive)
    if (stmt.reverbParams && dsp.reverbRef) {
      if (stmt.reverbParams.dryWetInterpolation) {
        const w = clamp01(this.evalInterpCached(track, stmt.reverbParams.dryWetInterpolation, elapsed));
        dsp.reverbRef.wet.gain.setTargetAtTime(w, ctxTime, PARAM_SMOOTHING);
        dsp.reverbRef.dry.gain.setTargetAtTime(1 - w, ctxTime, PARAM_SMOOTHING);
      }
    }

    // EQ (0-1 normalized → -12dB to +12dB)
    if (stmt.eqParams && dsp.eqRef) {
      const eq = stmt.eqParams;
      if (eq.lowGainInterpolation) {
        dsp.eqRef.low.gain.setTargetAtTime(
          mapEQGain(this.evalInterpCached(track, eq.lowGainInterpolation, elapsed)), ctxTime, PARAM_SMOOTHING);
      }
      if (eq.midGainInterpolation) {
        dsp.eqRef.mid.gain.setTargetAtTime(
          mapEQGain(this.evalInterpCached(track, eq.midGainInterpolation, elapsed)), ctxTime, PARAM_SMOOTHING);
      }
      if (eq.highGainInterpolation) {
        dsp.eqRef.high.gain.setTargetAtTime(
          mapEQGain(this.evalInterpCached(track, eq.highGainInterpolation, elapsed)), ctxTime, PARAM_SMOOTHING);
      }
    }
  }

  // ── Interpolation (cached per-track) ──

  /** Evaluate modulation (fade/jump) using cached 'every' duration. */
  private evalInterpCached(track: TrackState, mod: InterpolationData, elapsed: number): number {
    const every = track._cachedDurations.get(mod) ?? mod.every.sample();
    return SatieEngine.evalModulation(mod, elapsed, every);
  }

  /** Static evaluation for fade/jump modulation. */
  static evalModulation(mod: InterpolationData, elapsed: number, every: number): number {
    const n = mod.values.length;
    if (n === 0) return 0;
    if (n === 1) return mod.values[0];
    if (every <= 0) return mod.values[0];

    if (mod.modulationType === ModulationType.Fade) {
      return SatieEngine.evalFade(mod.values, elapsed, every, mod.loopMode);
    } else {
      return SatieEngine.evalJump(mod.values, elapsed, every, mod.loopMode);
    }
  }

  private static evalFade(values: number[], elapsed: number, every: number, loop: LoopMode): number {
    const n = values.length;
    const segments = n - 1;

    if (loop === LoopMode.None) {
      const totalDur = segments * every;
      if (elapsed >= totalDur) return values[n - 1];
      const seg = Math.min((elapsed / every) | 0, segments - 1);
      const t = (elapsed - seg * every) / every;
      return values[seg] + (values[seg + 1] - values[seg]) * t;
    }

    if (loop === LoopMode.Restart) {
      // Cycle through all values and wrap: 0→1→2→0→1→2→...
      const cycleDur = n * every;
      const cycleT = elapsed % cycleDur;
      const seg = (cycleT / every) | 0;
      const t = (cycleT - seg * every) / every;
      const from = seg % n;
      const to = (seg + 1) % n;
      return values[from] + (values[to] - values[from]) * t;
    }

    // Bounce: 0→1→2→1→0→1→2→...
    const bounceSeg = 2 * (n - 1);
    const cycleDur = bounceSeg * every;
    const cycleT = elapsed % cycleDur;
    const seg = (cycleT / every) | 0;
    const t = (cycleT - seg * every) / every;

    let fromIdx: number, toIdx: number;
    if (seg < n - 1) {
      fromIdx = seg;
      toIdx = seg + 1;
    } else {
      const backSeg = seg - (n - 1);
      fromIdx = (n - 1) - backSeg;
      toIdx = fromIdx - 1;
    }
    return values[fromIdx] + (values[toIdx] - values[fromIdx]) * t;
  }

  private static evalJump(values: number[], elapsed: number, every: number, loop: LoopMode): number {
    const n = values.length;

    if (loop === LoopMode.None) {
      const idx = Math.min((elapsed / every) | 0, n - 1);
      return values[idx];
    }

    if (loop === LoopMode.Restart) {
      const idx = ((elapsed / every) | 0) % n;
      return values[idx];
    }

    // Bounce: 0,1,2,1,0,1,2,1,...
    const bounceSeg = 2 * (n - 1);
    const seg = ((elapsed / every) | 0) % bounceSeg;
    const idx = seg < n ? seg : bounceSeg - seg;
    return values[idx];
  }

  /** Public evaluation — uses uncached path. */
  evaluateInterpolation(mod: InterpolationData, elapsed: number): number {
    const every = mod.every.sample();
    return SatieEngine.evalModulation(mod, elapsed, every);
  }

  // ── Spatial wander (in-place, no allocation) ──

  private calculateWanderPositionInPlace(track: TrackState, stmt: Statement, elapsed: number): void {
    const t = elapsed * track._wanderSpeed;

    let nx = (Math.sin(t + track._px1) + Math.sin(t * 1.3 + track._px2) + Math.sin(t * 0.7 + track._px1 * 0.3)) / 6 + 0.5;
    let ny = (Math.sin(t * 0.8 + track._py1) + Math.sin(t * 1.1 + track._py2) + Math.sin(t * 0.6 + track._py1 * 0.4)) / 6 + 0.5;
    let nz = (Math.sin(t * 1.2 + track._pz1) + Math.sin(t * 0.7 + track._pz2) + Math.sin(t * 0.9 + track._pz1 * 0.6)) / 6 + 0.5;

    // High-frequency noise perturbation — makes paths jittery/organic
    if (stmt.noise > 0) {
      const ht = elapsed * 3.7; // faster than the base wander
      const n = stmt.noise * 0.15;
      nx += (Math.sin(ht * 2.3 + track._px2 * 5) + Math.sin(ht * 3.1 + track._px1 * 7)) * n;
      ny += (Math.sin(ht * 1.9 + track._py2 * 5) + Math.sin(ht * 2.7 + track._py1 * 7)) * n;
      nz += (Math.sin(ht * 2.1 + track._pz2 * 5) + Math.sin(ht * 3.3 + track._pz1 * 7)) * n;
    }

    const minX = stmt.areaMin.x, minY = stmt.areaMin.y, minZ = stmt.areaMin.z;

    track.position.x = minX + (stmt.areaMax.x - minX) * nx;
    track.position.y = stmt.wanderType === WanderType.Walk ? 0 : minY + (stmt.areaMax.y - minY) * ny;
    track.position.z = minZ + (stmt.areaMax.z - minZ) * nz;
  }

  private calculateTrajectoryPositionInPlace(track: TrackState, stmt: Statement, elapsed: number): void {
    const trajectoryName = stmt.wanderType === WanderType.Custom ? stmt.customTrajectoryName : stmt.wanderType;
    const trajectory = trajectoryName ? getTrajectory(trajectoryName) : undefined;
    if (!trajectory) return;

    const speed = track.wanderHz; // wanderHz holds speed for trajectories
    const t = (elapsed * speed + track._trajectoryPhase) % 1;
    const pt = trajectory.evaluate(t);

    const minX = stmt.areaMin.x, minY = stmt.areaMin.y, minZ = stmt.areaMin.z;
    const rangeX = stmt.areaMax.x - minX;
    const rangeY = stmt.areaMax.y - minY;
    const rangeZ = stmt.areaMax.z - minZ;

    if (stmt.noise > 0) {
      // Per-voice sinusoidal noise — each instance diverges due to unique phase offsets
      const n = stmt.noise * 0.5; // scale: noise 1.0 = ±50% perturbation
      const nt = elapsed * 0.7;
      const nx = (Math.sin(nt + track._px1) + Math.sin(nt * 1.7 + track._px2)) * n;
      const ny = (Math.sin(nt * 0.9 + track._py1) + Math.sin(nt * 1.4 + track._py2)) * n;
      const nz = (Math.sin(nt * 1.1 + track._pz1) + Math.sin(nt * 1.6 + track._pz2)) * n;
      track.position.x = minX + rangeX * (pt.x + nx);
      track.position.y = minY + rangeY * (pt.y + ny);
      track.position.z = minZ + rangeZ * (pt.z + nz);
    } else {
      track.position.x = minX + rangeX * pt.x;
      track.position.y = minY + rangeY * pt.y;
      track.position.z = minZ + rangeZ * pt.z;
    }
  }

  private sampleInitialColor(stmt: Statement): string {
    if (stmt.colorRedRange || stmt.colorGreenRange || stmt.colorBlueRange) {
      const r = stmt.colorRedRange ? clamp255(Math.round(stmt.colorRedRange.sample() * 255)) : 0;
      const g = stmt.colorGreenRange ? clamp255(Math.round(stmt.colorGreenRange.sample() * 255)) : 0;
      const b = stmt.colorBlueRange ? clamp255(Math.round(stmt.colorBlueRange.sample() * 255)) : 0;
      return toHex(r, g, b);
    }
    return stmt.staticColor ?? '#1a3a2a';
  }

  destroy(): void {
    this.stop();
    this.ctx.close();
  }
}
