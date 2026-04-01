import { useState, useEffect, useRef, useCallback } from 'react';

export type ThemeMode = 'light' | 'dark' | 'fade';

export interface Theme {
  bg: string;
  text: string;
  textMuted: string;
  border: string;
  cardBg: string;
  cardBorder: string;
  invertedBg: string;
  invertedText: string;
  mode: ThemeMode;
}

const LIGHT: Theme = {
  bg: '#f4f3ee',
  text: '#0a0a0a',
  textMuted: 'rgba(10,10,10,0.35)',
  border: '#d0cdc4',
  cardBg: '#faf9f6',
  cardBorder: '#d0cdc4',
  invertedBg: '#0a0a0a',
  invertedText: '#faf9f6',
  mode: 'light',
};

const DARK: Theme = {
  bg: '#111110',
  text: '#e8e6e1',
  textMuted: 'rgba(232,230,225,0.35)',
  border: '#2a2926',
  cardBg: '#1a1918',
  cardBorder: '#2a2926',
  invertedBg: '#e8e6e1',
  invertedText: '#111110',
  mode: 'dark',
};

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

// ── Pastel palette for fade mode ──
// Each palette defines two gradient stops (bg is a CSS gradient) plus derived UI colors.
// The cycle drifts through these continuously.

interface PastelPalette {
  bgFrom: string;   // gradient start
  bgTo: string;     // gradient end
  cardBg: string;
  border: string;
}

const PASTELS: PastelPalette[] = [
  { bgFrom: '#f4f3ee', bgTo: '#f4f3ee', cardBg: '#faf9f6', border: '#d0cdc4' },  // warm cream (home base)
  { bgFrom: '#fce4ec', bgTo: '#f3e5f5', cardBg: '#fef0f5', border: '#e8b4c8' },  // rose → lavender
  { bgFrom: '#e8eaf6', bgTo: '#e0f2f1', cardBg: '#f0f1fa', border: '#b0b8d6' },  // periwinkle → mint
  { bgFrom: '#fff8e1', bgTo: '#fff3e0', cardBg: '#fffbf0', border: '#e0d0a8' },  // buttercream → peach
  { bgFrom: '#e0f7fa', bgTo: '#e8f5e9', cardBg: '#f0fbfc', border: '#a8d8d0' },  // ice blue → sage
  { bgFrom: '#f3e5f5', bgTo: '#ede7f6', cardBg: '#f8f0fb', border: '#c8b0d8' },  // lilac → wisteria
  { bgFrom: '#fbe9e7', bgTo: '#fff8e1', cardBg: '#fef2f0', border: '#dcc0b0' },  // blush → cream
  { bgFrom: '#e8f5e9', bgTo: '#f1f8e9', cardBg: '#f2faf2', border: '#b8d8b0' },  // sage → chartreuse
  { bgFrom: '#e3f2fd', bgTo: '#e8eaf6', cardBg: '#f0f5fe', border: '#a8c0e0' },  // sky → steel
  { bgFrom: '#fce4ec', bgTo: '#fff8e1', cardBg: '#fef0f0', border: '#e0c0b0' },  // rose → butter
];

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

  return {
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
