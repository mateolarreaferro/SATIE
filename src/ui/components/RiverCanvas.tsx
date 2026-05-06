import { useEffect, useRef } from 'react';
import type { ThemeMode } from '../theme/tokens';

/**
 * Ambient particle canvas — unique visual personality per theme mode.
 *
 * Light:  warm golden dust motes drifting upward, soft light bands
 * Dark:   falling luminous particles with twinkling + drifting nebula clouds
 * Fade:   prismatic orbs that wander gently, hue-shifting over time
 */

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  opacity: number;
  phase: number;
  hue: number;
  life: number;
  maxLife: number;
}

// ── Light mode: drifting spores — muted sage/olive tones, organic lazy movement ──

function createLightParticle(w: number, h: number): Particle {
  // Mix of sage greens, dusty olives, and warm grays
  const hues = [130, 140, 150, 160, 45, 30]; // greens + warm neutrals
  return {
    x: Math.random() * w,
    y: Math.random() * h,
    vx: (Math.random() - 0.5) * 0.1,
    vy: -(0.03 + Math.random() * 0.12),
    size: 1 + Math.random() * 2.5,
    opacity: 0,
    phase: Math.random() * Math.PI * 2,
    hue: hues[Math.floor(Math.random() * hues.length)],
    life: 0,
    maxLife: 600 + Math.random() * 1000,
  };
}

function drawLight(c: CanvasRenderingContext2D, particles: Particle[], cw: number, ch: number, t: number, dpr: number) {
  for (const p of particles) {
    // Lazy organic drift — slow wobble like pollen in still air
    p.x += (p.vx + Math.sin(p.phase + t * 0.003) * 0.08) * dpr;
    p.y += (p.vy + Math.cos(p.phase * 0.7 + t * 0.002) * 0.04) * dpr;
    p.life++;

    const r = p.life / p.maxLife;
    p.opacity = r < 0.2 ? r / 0.2 : r > 0.8 ? (1 - r) / 0.2 : 1;

    if (p.life > p.maxLife || p.y < -20 || p.x < -20 || p.x > cw + 20) {
      Object.assign(p, createLightParticle(cw, ch));
      p.y = ch + Math.random() * 30;
    }

    const sz = p.size * dpr;
    const sat = p.hue > 100 ? 20 : 12; // greens get a bit more sat, neutrals stay muted
    const light = 45 + Math.sin(p.phase + t * 0.01) * 5;

    // Single soft dot — no flashy glow, just a gentle speck
    c.beginPath();
    c.arc(p.x, p.y, sz, 0, Math.PI * 2);
    c.fillStyle = `hsla(${p.hue}, ${sat}%, ${light}%, ${p.opacity * 0.18})`;
    c.fill();
  }
}

// ── Dark mode: starfield with falling luminous particles + nebula ──

function createDarkParticle(w: number, h: number): Particle {
  return {
    x: Math.random() * w,
    y: -Math.random() * 60,
    vx: (Math.random() - 0.5) * 0.12,
    vy: 0.08 + Math.random() * 0.25,
    size: 1 + Math.random() * 3,
    opacity: 0,
    phase: Math.random() * Math.PI * 2,
    hue: 195 + Math.random() * 50,
    life: 0,
    maxLife: 1200 + Math.random() * 1800,
  };
}

function drawDark(c: CanvasRenderingContext2D, particles: Particle[], cw: number, ch: number, t: number, dpr: number) {
  // Nebula wisps — large drifting color clouds
  for (let i = 0; i < 3; i++) {
    const cx = cw * (0.2 + i * 0.3) + Math.sin(t * 0.0008 + i * 2.1) * 100 * dpr;
    const cy = ch * (0.25 + i * 0.22) + Math.cos(t * 0.001 + i * 1.3) * 70 * dpr;
    const radius = (130 + i * 50) * dpr;
    const hue = 210 + i * 35 + Math.sin(t * 0.0015) * 12;
    const nebula = c.createRadialGradient(cx, cy, 0, cx, cy, radius);
    nebula.addColorStop(0, `hsla(${hue}, 35%, 42%, 0.045)`);
    nebula.addColorStop(0.4, `hsla(${hue}, 30%, 38%, 0.02)`);
    nebula.addColorStop(1, 'hsla(0, 0%, 0%, 0)');
    c.beginPath();
    c.arc(cx, cy, radius, 0, Math.PI * 2);
    c.fillStyle = nebula;
    c.fill();
  }

  for (const p of particles) {
    p.x += p.vx * dpr;
    p.y += p.vy * dpr;
    p.x += Math.sin(p.phase + t * 0.004) * 0.15 * dpr;
    p.life++;

    const r = p.life / p.maxLife;
    const base = r < 0.1 ? r / 0.1 : r > 0.85 ? (1 - r) / 0.15 : 1;
    p.opacity = base * (0.5 + Math.sin(p.phase + t * 0.015) * 0.5); // twinkle

    if (p.life > p.maxLife || p.y > ch + 30) {
      Object.assign(p, createDarkParticle(cw, ch));
    }

    const sz = p.size * dpr;
    const glow = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, sz * 3);
    glow.addColorStop(0, `hsla(${p.hue}, 55%, 78%, ${p.opacity * 0.2})`);
    glow.addColorStop(0.4, `hsla(${p.hue}, 45%, 65%, ${p.opacity * 0.06})`);
    glow.addColorStop(1, 'hsla(0, 0%, 0%, 0)');
    c.beginPath();
    c.arc(p.x, p.y, sz * 3, 0, Math.PI * 2);
    c.fillStyle = glow;
    c.fill();

    c.beginPath();
    c.arc(p.x, p.y, sz * 0.4, 0, Math.PI * 2);
    c.fillStyle = `hsla(${p.hue}, 45%, 88%, ${p.opacity * 0.45})`;
    c.fill();
  }
}

// ── Fade mode: drifting aurora washes — large soft color fields, no particles ──

function createFadeParticle(w: number, h: number): Particle {
  // Not used for drawing particles — just satisfies the interface
  return { x: 0, y: 0, vx: 0, vy: 0, size: 0, opacity: 0, phase: 0, hue: 0, life: 0, maxLife: 1 };
}

function drawFade(c: CanvasRenderingContext2D, _particles: Particle[], cw: number, ch: number, t: number, dpr: number) {
  // Several large, slow-drifting color washes that overlap and blend
  c.globalCompositeOperation = 'source-over';

  for (let i = 0; i < 5; i++) {
    // Each wash orbits slowly in its own elliptical path
    const speed = 0.0003 + i * 0.0001;
    const cx = cw * (0.3 + i * 0.1) + Math.sin(t * speed + i * 1.3) * cw * 0.25;
    const cy = ch * (0.25 + i * 0.12) + Math.cos(t * speed * 0.7 + i * 0.9) * ch * 0.2;
    const radius = (200 + i * 60) * dpr;

    // Hue shifts slowly over time, each wash offset
    const hue = (t * 0.08 + i * 72) % 360;
    const sat = 35 + Math.sin(t * 0.002 + i) * 10;
    const light = 78 + Math.sin(t * 0.003 + i * 0.5) * 5;
    const alpha = 0.04 + Math.sin(t * 0.002 + i * 1.7) * 0.015;

    const grad = c.createRadialGradient(cx, cy, 0, cx, cy, radius);
    grad.addColorStop(0, `hsla(${hue}, ${sat}%, ${light}%, ${alpha})`);
    grad.addColorStop(0.6, `hsla(${hue + 30}, ${sat - 5}%, ${light + 3}%, ${alpha * 0.4})`);
    grad.addColorStop(1, 'hsla(0, 0%, 0%, 0)');

    c.fillStyle = grad;
    c.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
  }
}

// ── Component ──

const PARTICLE_COUNT = 140;

type CreateFn = (w: number, h: number) => Particle;
type DrawFn = (c: CanvasRenderingContext2D, particles: Particle[], cw: number, ch: number, t: number, dpr: number) => void;

const MODE_CONFIG: Record<ThemeMode, { create: CreateFn; draw: DrawFn }> = {
  light:  { create: createLightParticle, draw: drawLight },
  dark:   { create: createDarkParticle,  draw: drawDark },
  fade:   { create: createFadeParticle,  draw: drawFade },
  // 'system' falls back to light particles — callers should normally pass
  // resolvedMode here so this branch is rarely hit.
  system: { create: createLightParticle, draw: drawLight },
};

export function RiverCanvas({ mode = 'light' }: { mode?: ThemeMode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef(0);
  const particlesRef = useRef<Particle[]>([]);
  const timeRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let running = true;
    let cw = 0;
    let ch = 0;

    const resize = () => {
      const dpr = window.devicePixelRatio;
      cw = window.innerWidth * dpr;
      ch = window.innerHeight * dpr;
      canvas.width = cw;
      canvas.height = ch;
    };
    resize();
    window.addEventListener('resize', resize);

    const { create, draw } = MODE_CONFIG[mode];
    particlesRef.current = Array.from({ length: PARTICLE_COUNT }, () => create(cw, ch));

    const animate = () => {
      if (!running) return;
      const dpr = window.devicePixelRatio;
      timeRef.current += 1;
      ctx.clearRect(0, 0, cw, ch);
      draw(ctx, particlesRef.current, cw, ch, timeRef.current, dpr);
      frameRef.current = requestAnimationFrame(animate);
    };

    frameRef.current = requestAnimationFrame(animate);

    return () => {
      running = false;
      cancelAnimationFrame(frameRef.current);
      window.removeEventListener('resize', resize);
    };
  }, [mode]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 0,
      }}
    />
  );
}
