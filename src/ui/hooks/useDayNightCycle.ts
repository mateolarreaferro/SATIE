import { useState, useEffect, useRef, useCallback } from 'react';
import { LIGHT, DARK, PASTELS } from '../theme/tokens';
import type { Theme as ThemeToken } from '../theme/tokens';

// Re-export for backward compat — existing callers do `import { Theme } from './useDayNightCycle'`.
export type Theme = ThemeToken;
export type ThemeMode = 'light' | 'dark' | 'fade';

// ── Color math ──

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(c => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0')).join('');
}

function lerpColor(c1: string, c2: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(c1);
  const [r2, g2, b2] = hexToRgb(c2);
  return rgbToHex(lerp(r1, r2, t), lerp(g1, g2, t), lerp(b1, b2, t));
}

// Time per palette transition: 10 seconds. Full cycle = PASTELS.length * 10s
const PALETTE_DURATION_MS = 10_000;

/** Subtle sine chime when transitioning to a new palette */
function playPaletteChime(index: number) {
  try {
    const ctx = new AudioContext();
    if (ctx.state === 'suspended') ctx.resume();

    // Each palette gets a different pitch from C major
    const notes = [262, 294, 330, 392, 440, 494, 523, 587, 659, 523];
    const freq = notes[index % notes.length];

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.0078, ctx.currentTime + 0.8);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 2.5);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 600;
    filter.Q.value = 0.3;

    osc.connect(filter).connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 2.5);
    setTimeout(() => ctx.close(), 3500);
  } catch { /* audio not available */ }
}

function buildFadeTheme(progress: number): Theme {
  const totalPalettes = PASTELS.length;
  const scaled = progress * totalPalettes;
  const idx = Math.floor(scaled) % totalPalettes;
  const next = (idx + 1) % totalPalettes;
  const t = scaled - Math.floor(scaled);
  // Smooth cosine interpolation
  const smooth = (1 - Math.cos(t * Math.PI)) / 2;

  const from = PASTELS[idx];
  const to = PASTELS[next];

  const bgFrom = lerpColor(from.bgFrom, to.bgFrom, smooth);
  const bgTo = lerpColor(from.bgTo, to.bgTo, smooth);
  const cardBg = lerpColor(from.cardBg, to.cardBg, smooth);
  const border = lerpColor(from.border, to.border, smooth);
  const cardBorder = lerpColor(from.border, to.border, smooth);

  // Build a fade theme by spreading LIGHT (so all the new tokens — accent, danger,
  // overlayBg, monaco, etc. — are inherited) and overriding the surface colors
  // that drift across the pastel cycle.
  return {
    ...LIGHT,
    bg: `linear-gradient(135deg, ${bgFrom}, ${bgTo})`,
    text: '#0a0a0a',
    textMuted: 'rgba(10,10,10,0.5)',
    border,
    cardBg,
    cardBorder,
    invertedBg: '#0a0a0a',
    invertedText: '#faf9f6',
    mode: 'fade',
  };
}

// ── Hook ──

const STORAGE_KEY = 'satie-theme-mode';

function loadMode(): ThemeMode {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark' || stored === 'fade') return stored;
  return 'fade';
}

export function useDayNightCycle(): { theme: Theme; mode: ThemeMode; setMode: (m: ThemeMode) => void } {
  const [mode, setModeState] = useState<ThemeMode>(loadMode);
  const [theme, setTheme] = useState<Theme>(LIGHT);
  const startTime = useRef(Date.now());
  const lastPaletteIdx = useRef(-1);
  const raf = useRef(0);

  const setMode = useCallback((m: ThemeMode) => {
    localStorage.setItem(STORAGE_KEY, m);
    setModeState(m);
  }, []);

  // Static modes
  useEffect(() => {
    if (mode === 'light') {
      setTheme(LIGHT);
      cancelAnimationFrame(raf.current);
    } else if (mode === 'dark') {
      setTheme(DARK);
      cancelAnimationFrame(raf.current);
    }
  }, [mode]);

  // Fade mode — pastel color drift
  useEffect(() => {
    if (mode !== 'fade') return;

    const cycleDuration = PASTELS.length * PALETTE_DURATION_MS;
    let lastUpdate = 0;
    const THROTTLE_MS = 200; // 5fps is plenty for slow color drift

    const update = (now: number) => {
      if (now - lastUpdate >= THROTTLE_MS) {
        lastUpdate = now;
        const elapsed = Date.now() - startTime.current;
        const progress = (elapsed % cycleDuration) / cycleDuration;
        const paletteIdx = Math.floor(progress * PASTELS.length) % PASTELS.length;

        setTheme(buildFadeTheme(progress));

        // Chime on palette transition
        if (paletteIdx !== lastPaletteIdx.current && lastPaletteIdx.current !== -1) {
          playPaletteChime(paletteIdx);
        }
        lastPaletteIdx.current = paletteIdx;
      }

      raf.current = requestAnimationFrame(update);
    };

    raf.current = requestAnimationFrame(update);
    return () => cancelAnimationFrame(raf.current);
  }, [mode]);

  return { theme, mode, setMode };
}
