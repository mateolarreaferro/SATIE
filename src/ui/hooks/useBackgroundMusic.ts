import { useEffect, useState, useCallback } from 'react';

/**
 * Singleton background music player.
 * Persists across route changes — only one instance plays at a time.
 * Starts on first user gesture, loops forever until stopped.
 */

let ctx: AudioContext | null = null;
let source: AudioBufferSourceNode | null = null;
let gain: GainNode | null = null;
let started = false;
let audioData: ArrayBuffer | null = null;
let activeCount = 0; // number of mounted components using the music
let fetchingFor: string | null = null;
let lastSrc: string | null = null;
let lastVolume = 0.08;
let softStopped = false; // true after stopBackgroundMusic() — cleared on next hook mount
let musicEnabled = localStorage.getItem('satie-music-enabled') !== 'false'; // default true
const enabledListeners = new Set<(enabled: boolean) => void>();

function notifyListeners() {
  enabledListeners.forEach(fn => fn(musicEnabled));
}

function tryStart(volume: number) {
  if (started || !audioData || !musicEnabled) return;

  const c = new AudioContext();
  if (c.state === 'suspended') {
    c.close();
    return;
  }

  started = true;
  ctx = c;

  c.decodeAudioData(audioData.slice(0))
    .then(audioBuf => {
      if (!ctx || ctx !== c) { c.close(); return; }

      const g = c.createGain();
      g.gain.setValueAtTime(0, c.currentTime);
      g.gain.linearRampToValueAtTime(volume, c.currentTime + 5);
      g.connect(c.destination);
      gain = g;

      const s = c.createBufferSource();
      s.buffer = audioBuf;
      s.loop = true;
      s.connect(g);
      s.start();
      source = s;
    })
    .catch(() => { /* decode failed */ });
}

/** Stop playback but keep audioData so music can restart without re-fetching */
function stopPlayback() {
  if (gain && ctx && ctx.state !== 'closed') {
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0, now + 0.8);
    const c = ctx;
    const s = source;
    setTimeout(() => {
      try { s?.stop(); } catch { /* ok */ }
      try { c.close(); } catch { /* ok */ }
    }, 900);
  } else {
    try { source?.stop(); } catch { /* ok */ }
    try { ctx?.close(); } catch { /* ok */ }
  }
  ctx = null;
  source = null;
  gain = null;
  started = false;
}

/** Full cleanup — stops playback and discards audio data */
function stopMusic() {
  stopPlayback();
  audioData = null;
  fetchingFor = null;
}

/** Stop background music (e.g. when user starts generating). Non-permanent — will restart on next hook mount. */
export function stopBackgroundMusic() {
  softStopped = true;
  stopPlayback();
}

/** Get current music enabled state */
export function getMusicEnabled() {
  return musicEnabled;
}

/** Toggle music on/off globally (persisted to localStorage) */
export function setMusicEnabled(enabled: boolean) {
  musicEnabled = enabled;
  localStorage.setItem('satie-music-enabled', String(enabled));
  if (!enabled) {
    stopPlayback();
  } else if (activeCount > 0 && !started) {
    // Re-enable: restart music if a page is using the hook
    if (audioData) {
      tryStart(lastVolume);
    } else if (lastSrc) {
      fetchingFor = lastSrc;
      fetch(lastSrc)
        .then(res => res.arrayBuffer())
        .then(buf => { audioData = buf; tryStart(lastVolume); })
        .catch(() => {});
    }
  }
  notifyListeners();
}

/** React hook for reading/toggling the music enabled state */
export function useMusicEnabled(): [boolean, (enabled: boolean) => void] {
  const [enabled, setEnabled] = useState(musicEnabled);

  useEffect(() => {
    const handler = (val: boolean) => setEnabled(val);
    enabledListeners.add(handler);
    // Sync in case it changed before mount
    setEnabled(musicEnabled);
    return () => { enabledListeners.delete(handler); };
  }, []);

  const toggle = useCallback((val: boolean) => {
    setMusicEnabled(val);
  }, []);

  return [enabled, toggle];
}

/**
 * Hook: call from any page that should have background music.
 * Music continues seamlessly when navigating between pages that both call this hook.
 * Music fades out only when ALL pages using it have unmounted (e.g. navigating to Editor).
 */
export function useBackgroundMusic(src: string, volume = 0.08) {
  useEffect(() => {
    activeCount++;
    lastSrc = src;
    lastVolume = volume;
    softStopped = false;

    // Fetch audio data if not already loaded
    if (!audioData && fetchingFor !== src) {
      fetchingFor = src;
      fetch(src)
        .then(res => res.arrayBuffer())
        .then(buf => {
          audioData = buf;
          tryStart(volume);
        })
        .catch(() => { /* not available */ });
    } else if (!started && audioData) {
      tryStart(volume);
    }

    function onGesture() {
      if (!musicEnabled || softStopped) return;
      if (started) {
        if (ctx?.state === 'suspended') ctx.resume();
        return;
      }
      tryStart(volume);
    }

    window.addEventListener('click', onGesture);
    window.addEventListener('keydown', onGesture);
    window.addEventListener('pointerdown', onGesture);

    return () => {
      window.removeEventListener('click', onGesture);
      window.removeEventListener('keydown', onGesture);
      window.removeEventListener('pointerdown', onGesture);

      activeCount--;
      // Only stop if no other pages are using it
      // Use a short delay so route transitions don't cause a gap
      setTimeout(() => {
        if (activeCount <= 0) {
          stopMusic();
          activeCount = 0;
        }
      }, 200);
    };
  }, [src, volume]);
}
