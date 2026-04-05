/**
 * Hook for previewing audio samples inline.
 * Manages a single AudioBufferSourceNode — only one preview plays at a time.
 * Supports seeking and progress tracking.
 */
import { useRef, useState, useCallback, useEffect } from 'react';

let _previewCtx: AudioContext | null = null;
function getPreviewCtx(): AudioContext {
  if (!_previewCtx || _previewCtx.state === 'closed') _previewCtx = new AudioContext();
  if (_previewCtx.state === 'suspended') _previewCtx.resume();
  return _previewCtx;
}

export function useSamplePreview() {
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const bufferRef = useRef<AudioBuffer | null>(null);
  const playingIdRef = useRef<string | null>(null);
  const startTimeRef = useRef(0);   // ctx.currentTime when playback started
  const offsetRef = useRef(0);      // offset into the buffer (for seeking)
  const rafRef = useRef(0);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0); // 0–1

  const stopInternal = useCallback(() => {
    if (sourceRef.current) {
      try { sourceRef.current.stop(); } catch { /* already stopped */ }
      sourceRef.current = null;
    }
    cancelAnimationFrame(rafRef.current);
    playingIdRef.current = null;
    bufferRef.current = null;
    setPlayingId(null);
    setProgress(0);
  }, []);

  const updateProgress = useCallback(() => {
    if (!playingIdRef.current || !bufferRef.current) return;
    const ctx = getPreviewCtx();
    const elapsed = ctx.currentTime - startTimeRef.current + offsetRef.current;
    const duration = bufferRef.current.duration;
    const p = Math.min(elapsed / duration, 1);
    setProgress(p);
    if (p < 1) {
      rafRef.current = requestAnimationFrame(updateProgress);
    } else {
      // Playback ended
      playingIdRef.current = null;
      sourceRef.current = null;
      bufferRef.current = null;
      setPlayingId(null);
      setProgress(0);
    }
  }, []);

  const play = useCallback(async (id: string, data: ArrayBuffer, seekTo?: number) => {
    const ctx = getPreviewCtx();

    // If same sample is playing and no seek, toggle off
    if (playingIdRef.current === id && seekTo === undefined) {
      stopInternal();
      return;
    }

    // Stop any current preview
    if (sourceRef.current) {
      try { sourceRef.current.stop(); } catch { /* ok */ }
      sourceRef.current = null;
    }
    cancelAnimationFrame(rafRef.current);

    let buffer = bufferRef.current;
    if (!buffer || playingIdRef.current !== id) {
      buffer = await ctx.decodeAudioData(data.slice(0));
    }
    bufferRef.current = buffer;

    const offset = seekTo !== undefined ? seekTo * buffer.duration : 0;
    offsetRef.current = offset;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.onended = () => {
      if (playingIdRef.current === id) {
        playingIdRef.current = null;
        sourceRef.current = null;
        bufferRef.current = null;
        setPlayingId(null);
        setProgress(0);
      }
    };
    source.start(0, offset);
    startTimeRef.current = ctx.currentTime;
    sourceRef.current = source;
    playingIdRef.current = id;
    setPlayingId(id);
    rafRef.current = requestAnimationFrame(updateProgress);
  }, [stopInternal, updateProgress]);

  const stop = stopInternal;

  const isPlaying = useCallback((id: string) => {
    return playingIdRef.current === id;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopInternal();
    };
  }, [stopInternal]);

  return { play, stop, isPlaying, playingId, progress };
}
