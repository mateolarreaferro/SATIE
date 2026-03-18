import { useRef, useCallback } from 'react';

// Minimal UI sounds — subtle and tasteful. Most interactions are near-silent.

let sharedCtx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!sharedCtx) sharedCtx = new AudioContext();
  if (sharedCtx.state === 'suspended') sharedCtx.resume();
  return sharedCtx;
}

/** Low, soft noise thud */
function thud(volume = 0.04) {
  const ctx = getCtx();
  const len = Math.ceil(ctx.sampleRate * 0.04);
  const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 600;
  filter.Q.value = 0.3;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(volume, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.04);

  source.connect(filter).connect(gain).connect(ctx.destination);
  source.start();
  source.stop(ctx.currentTime + 0.04);
}

/** Softer, slightly brighter tap */
function tap(volume = 0.03) {
  const ctx = getCtx();
  const len = Math.ceil(ctx.sampleRate * 0.025);
  const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 1200;
  filter.Q.value = 0.5;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(volume, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.025);

  source.connect(filter).connect(gain).connect(ctx.destination);
  source.start();
  source.stop(ctx.currentTime + 0.025);
}

/** Very subtle noise micro-tap for hover — no pitch, just a soft click */
function microTap(volume = 0.015) {
  const ctx = getCtx();
  const len = Math.ceil(ctx.sampleRate * 0.012); // 12ms — extremely short
  const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = 2000;
  filter.Q.value = 0.3;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(volume, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.012);

  source.connect(filter).connect(gain).connect(ctx.destination);
  source.start();
  source.stop(ctx.currentTime + 0.012);
}

export function useSFX() {
  const enabled = useRef(true);
  const lastHover = useRef(0);

  const hover = useCallback(() => {
    if (!enabled.current) return;
    const now = performance.now();
    // 120ms cooldown — prevents rapid-fire when moving across buttons
    if (now - lastHover.current < 120) return;
    lastHover.current = now;
    microTap(0.015);
  }, []);

  const click = useCallback(() => {
    if (!enabled.current) return;
    tap(0.025);
  }, []);

  const save = useCallback(() => {
    if (!enabled.current) return;
    tap(0.02);
  }, []);

  const toggle = useCallback(() => {
    if (!enabled.current) return;
    tap(0.03);
  }, []);

  const open = useCallback(() => {}, []);
  const close = useCallback(() => {}, []);

  // Only play/stop/delete get louder sound — the key moments
  const play = useCallback(() => {
    if (!enabled.current) return;
    tap(0.04);
  }, []);

  const stop = useCallback(() => {
    if (!enabled.current) return;
    thud(0.035);
  }, []);

  const del = useCallback(() => {
    if (!enabled.current) return;
    thud(0.05);
  }, []);

  const splash = useCallback(() => {}, []);

  return { hover, click, play, stop, save, toggle, open, close, del, splash, enabled };
}
