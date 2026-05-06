import { useRef, useState, useEffect, useCallback } from 'react';
import { SatieEngine, type EngineUIState, type TrackState } from '../../engine';
import { getMusicEnabled, subscribeMusicEnabled } from './useBackgroundMusic';

/**
 * Main hook for the Satie engine.
 *
 * Performance design:
 * - `uiState` updates at ~8fps (throttled) — use for time display, track count, errors
 * - `tracksRef` points to the engine's live tracks array — use in Three.js useFrame()
 * - Discrete events (play/stop/loadScript) trigger immediate UI updates
 */
export function useSatieEngine() {
  const engineRef = useRef<SatieEngine | null>(null);
  const tracksRef = useRef<TrackState[]>([]);
  // Track the user's intended master volume separately from the global app-mute
  // state. The engine receives `userMasterVol * (muted ? 0 : 1)` so unmuting
  // restores whatever the user dialed in on the Sidebar slider.
  const userMasterVolRef = useRef(1);

  const applyMasterVolume = useCallback(() => {
    const muted = !getMusicEnabled();
    engineRef.current?.setMasterVolume(muted ? 0 : userMasterVolRef.current);
  }, []);

  const emptySet = useRef<ReadonlySet<number>>(new Set()).current;
  const [uiState, setUIState] = useState<EngineUIState>({
    isPlaying: false,
    currentTime: 0,
    trackCount: 0,
    statements: [],
    errors: null,
    runtimeWarnings: [],
    mutedIndices: emptySet,
    soloedIndices: emptySet,
  });

  useEffect(() => {
    const engine = new SatieEngine();
    engineRef.current = engine;
    // Sync engine to the current global mute state on mount.
    applyMasterVolume();

    // Subscribe to throttled UI updates only
    const unsub = engine.subscribeUI((state) => {
      // Update tracks ref (no React re-render)
      tracksRef.current = engine.getTracksArray();
      setUIState(state);
    });

    // Subscribe to the global mute state — header toggle dims engine output too.
    const unsubMute = subscribeMusicEnabled(() => applyMasterVolume());

    return () => {
      unsub();
      unsubMute();
      engine.destroy();
    };
  }, [applyMasterVolume]);

  const loadScript = useCallback((script: string) => {
    engineRef.current?.loadScript(script);
    if (engineRef.current) {
      tracksRef.current = engineRef.current.getTracksArray();
    }
  }, []);

  const play = useCallback(async () => {
    await engineRef.current?.play();
  }, []);

  const stop = useCallback(() => {
    engineRef.current?.stop();
    if (engineRef.current) {
      tracksRef.current = engineRef.current.getTracksArray();
    }
  }, []);

  const loadAudioFile = useCallback(async (name: string, url: string) => {
    await engineRef.current?.loadAudioFile(name, url);
  }, []);

  const loadAudioBuffer = useCallback(async (name: string, data: ArrayBuffer) => {
    await engineRef.current?.loadAudioBuffer(name, data);
  }, []);

  const setMasterVolume = useCallback((vol: number) => {
    userMasterVolRef.current = vol;
    applyMasterVolume();
  }, [applyMasterVolume]);

  const toggleMute = useCallback((index: number) => {
    engineRef.current?.toggleMute(index);
  }, []);

  const toggleSolo = useCallback((index: number) => {
    engineRef.current?.toggleSolo(index);
  }, []);

  const setListenerPosition = useCallback((x: number, y: number, z: number) => {
    engineRef.current?.setListenerPosition(x, y, z);
  }, []);

  const setListenerOrientation = useCallback((fx: number, fy: number, fz: number, ux: number, uy: number, uz: number) => {
    engineRef.current?.setListenerOrientation(fx, fy, fz, ux, uy, uz);
  }, []);

  const setOnMissingBuffer = useCallback((cb: ((clipName: string) => Promise<ArrayBuffer | null>) | null) => {
    if (engineRef.current) {
      engineRef.current.onMissingBuffer = cb;
    }
  }, []);

  const setOnSearchCommunity = useCallback((cb: ((prompt: string) => Promise<ArrayBuffer | null>) | null) => {
    if (engineRef.current) {
      engineRef.current.onSearchCommunity = cb;
    }
  }, []);

  const setPreferCommunity = useCallback((value: boolean) => {
    if (engineRef.current) {
      engineRef.current.preferCommunitySamples = value;
    }
  }, []);

  return {
    engine: engineRef,
    uiState,
    tracksRef,
    loadScript,
    play,
    stop,
    loadAudioFile,
    loadAudioBuffer,
    setMasterVolume,
    toggleMute,
    toggleSolo,
    setListenerPosition,
    setListenerOrientation,
    setOnMissingBuffer,
    setOnSearchCommunity,
    setPreferCommunity,
  };
}
