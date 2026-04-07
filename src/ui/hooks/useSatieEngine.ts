import { useRef, useState, useEffect, useCallback } from 'react';
import { SatieEngine, type EngineUIState, type TrackState } from '../../engine';

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

  // Track whether we paused due to tab hidden (so we can auto-resume)
  const pausedByVisibility = useRef(false);

  useEffect(() => {
    const engine = new SatieEngine();
    engineRef.current = engine;

    // Subscribe to throttled UI updates only
    const unsub = engine.subscribeUI((state) => {
      // Update tracks ref (no React re-render)
      tracksRef.current = engine.getTracksArray();
      setUIState(state);
    });

    // Pause engine when tab is hidden to prevent background API calls / credit drain
    const handleVisibilityChange = () => {
      if (!engineRef.current) return;
      if (document.hidden) {
        if (engineRef.current.isPlaying) {
          engineRef.current.stop();
          pausedByVisibility.current = true;
        }
      } else if (pausedByVisibility.current) {
        pausedByVisibility.current = false;
        engineRef.current.play();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      unsub();
      engine.destroy();
    };
  }, []);

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
    engineRef.current?.setMasterVolume(vol);
  }, []);

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
