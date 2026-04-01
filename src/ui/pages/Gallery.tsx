import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../lib/AuthContext';
import { getPublicSketches } from '../../lib/sketches';
import { useSFX } from '../hooks/useSFX';
import { useDayNightCycle, type ThemeMode, type Theme } from '../hooks/useDayNightCycle';
import { useBackgroundMusic } from '../hooks/useBackgroundMusic';
import { RiverCanvas } from '../components/RiverCanvas';
import type { Sketch } from '../../lib/supabase';

// ── Physics (shared logic with Dashboard) ──

interface PhysicsBody {
  x: number; y: number;
  vx: number; vy: number;
  w: number; h: number;
  colliding: boolean;
}

const CARD_W = 280;
const CARD_H = 150;

/** Shared AudioContext for collision sounds */
let _collisionCtx: AudioContext | null = null;
function getCollisionCtx(): AudioContext {
  if (!_collisionCtx || _collisionCtx.state === 'closed') _collisionCtx = new AudioContext();
  if (_collisionCtx.state === 'suspended') _collisionCtx.resume();
  return _collisionCtx;
}

function collisionSound(speed: number) {
  try {
    const ctx = getCollisionCtx();
    const len = Math.ceil(ctx.sampleRate * 0.03);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const source = ctx.createBufferSource();
    source.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 800 + speed * 2000;
    filter.Q.value = 1.5;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(Math.min(0.075, 0.0125 + speed * 0.0375), ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.03);
    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start();
    source.stop(ctx.currentTime + 0.03);
  } catch { /* ok */ }
}

function usePhysics(count: number, containerRef: React.RefObject<HTMLDivElement | null>) {
  const bodies = useRef<PhysicsBody[]>([]);
  const raf = useRef(0);
  const dragging = useRef(-1);
  const containerSize = useRef({ w: 1200, h: 600 });

  // Track container size via ResizeObserver
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        containerSize.current.w = entry.contentRect.width;
        containerSize.current.h = entry.contentRect.height;
      }
    });
    ro.observe(el);
    const rect = el.getBoundingClientRect();
    containerSize.current.w = rect.width;
    containerSize.current.h = rect.height;
    return () => ro.disconnect();
  }, [containerRef]);

  useEffect(() => {
    const cw = containerSize.current.w;
    const ch = containerSize.current.h;
    const pad = 20;

    const newBodies: PhysicsBody[] = [];
    const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
    for (let i = 0; i < count; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const cellW = (cw - pad * 2) / cols;
      const cellH = (ch - pad * 2) / Math.max(1, Math.ceil(count / cols));
      newBodies.push({
        x: pad + col * cellW + (cellW - CARD_W) / 2 + (Math.random() - 0.5) * 20,
        y: pad + row * cellH + (cellH - CARD_H) / 2 + (Math.random() - 0.5) * 15,
        vx: (Math.random() - 0.5) * 0.12,
        vy: (Math.random() - 0.5) * 0.12,
        w: CARD_W, h: CARD_H, colliding: false,
      });
    }
    bodies.current = newBodies;
  }, [count]);

  useEffect(() => {
    let lastCollision = 0;
    let lastFrameTime = performance.now();
    const step = () => {
      const cw = containerSize.current.w, ch = containerSize.current.h;
      if (cw === 0) { raf.current = requestAnimationFrame(step); return; }
      const bs = bodies.current;
      const now = performance.now();
      const dt = Math.min((now - lastFrameTime) / 16.667, 3);
      lastFrameTime = now;

      for (let i = 0; i < bs.length; i++) {
        const b = bs[i];
        const isDragged = i === dragging.current;
        b.colliding = false;

        if (!isDragged) {
          b.x += b.vx * dt;
          b.y += b.vy * dt;
          const dampFactor = Math.pow(0.9995, dt);
          b.vx *= dampFactor;
          b.vy *= dampFactor;

          const spd = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
          if (spd < 0.02) {
            const a = Math.random() * Math.PI * 2;
            b.vx += Math.cos(a) * 0.004;
            b.vy += Math.sin(a) * 0.004;
          }

          // Walls
          if (b.x < 0) { b.x = 0; b.vx = Math.max(0.1, Math.abs(b.vx) * 0.4); b.colliding = true; }
          if (b.y < 0) { b.y = 0; b.vy = Math.max(0.1, Math.abs(b.vy) * 0.4); b.colliding = true; }
          if (b.x + b.w > cw) { b.x = cw - b.w; b.vx = -Math.max(0.1, Math.abs(b.vx) * 0.4); b.colliding = true; }
          if (b.y + b.h > ch) { b.y = ch - b.h; b.vy = -Math.max(0.1, Math.abs(b.vy) * 0.4); b.colliding = true; }
          b.x = Math.max(0, Math.min(cw - b.w, b.x));
          b.y = Math.max(0, Math.min(ch - b.h, b.y));
        }

        // Card collisions (including dragged cards)
        for (let j = i + 1; j < bs.length; j++) {
          const o = bs[j];
          const ox = Math.min(b.x + b.w, o.x + o.w) - Math.max(b.x, o.x);
          const oy = Math.min(b.y + b.h, o.y + o.h) - Math.max(b.y, o.y);
          if (ox > 0 && oy > 0) {
            b.colliding = true; o.colliding = true;
            const bDrag = i === dragging.current;
            const oDrag = j === dragging.current;
            if (ox < oy) {
              const s = b.x < o.x ? -1 : 1;
              if (bDrag) { o.x -= s * ox; o.vx = -s * Math.max(1.5, Math.abs(b.vx) + 1) * 0.6; }
              else if (oDrag) { b.x += s * ox; b.vx = s * Math.max(1.5, Math.abs(o.vx) + 1) * 0.6; }
              else { b.x += s * ox * 0.5; o.x -= s * ox * 0.5; const t = b.vx; b.vx = o.vx * 0.6; o.vx = t * 0.6; }
            } else {
              const s = b.y < o.y ? -1 : 1;
              if (bDrag) { o.y -= s * oy; o.vy = -s * Math.max(1.5, Math.abs(b.vy) + 1) * 0.6; }
              else if (oDrag) { b.y += s * oy; b.vy = s * Math.max(1.5, Math.abs(o.vy) + 1) * 0.6; }
              else { b.y += s * oy * 0.5; o.y -= s * oy * 0.5; const t = b.vy; b.vy = o.vy * 0.6; o.vy = t * 0.6; }
            }
            if (now - lastCollision > 80) {
              lastCollision = now;
              collisionSound(Math.sqrt((b.vx - o.vx) ** 2 + (b.vy - o.vy) ** 2));
            }
          }
        }
      }

      const cards = containerRef.current?.querySelectorAll<HTMLDivElement>('.gallery-card');
      if (cards) {
        for (let i = 0; i < cards.length && i < bs.length; i++) {
          const b = bs[i];
          cards[i].style.transform = b.colliding
            ? `translate3d(${b.x}px, ${b.y}px, 0) scale(0.98)`
            : `translate3d(${b.x}px, ${b.y}px, 0)`;
          cards[i].style.borderColor = b.colliding ? '#1a3a2a' : '#d0cdc4';
        }
      }
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [count]);

  return { bodies: bodies.current, dragging };
}

// ── Gallery card with drag support ──

function GalleryCard({ sketch, body, index, draggingRef, onClick, sfx, formatDate, theme }: {
  sketch: Sketch;
  body: PhysicsBody;
  index: number;
  draggingRef: React.MutableRefObject<number>;
  onClick: () => void;
  sfx: ReturnType<typeof useSFX>;
  formatDate: (iso: string) => string;
  theme: Theme;
}) {
  const totalDist = useRef(0);

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX, startY = e.clientY;
    const offsetX = e.clientX - body.x, offsetY = e.clientY - body.y;
    let lastMx = 0, lastMy = 0;
    totalDist.current = 0;
    draggingRef.current = index;

    const onMove = (ev: MouseEvent) => {
      totalDist.current = Math.sqrt((ev.clientX - startX) ** 2 + (ev.clientY - startY) ** 2);
      body.x = ev.clientX - offsetX;
      body.y = ev.clientY - offsetY;
      body.vx = 0; body.vy = 0;
      lastMx = ev.movementX || 0;
      lastMy = ev.movementY || 0;
    };
    const onUp = () => {
      draggingRef.current = -1;
      body.vx = lastMx * 0.4;
      body.vy = lastMy * 0.4;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [body, index, draggingRef]);

  const handleClick = useCallback(() => {
    if (totalDist.current > 5) return;
    sfx.open();
    onClick();
  }, [onClick, sfx]);

  return (
    <div
      className="gallery-card"
      onMouseDown={onDragStart}
      onMouseUp={handleClick}
      onMouseEnter={sfx.hover}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: CARD_W,
        background: theme.mode === 'dark' ? 'rgba(26,25,24,0.75)' : theme.mode === 'fade' ? 'rgba(255,255,255,0.25)' : 'rgba(250,249,246,0.65)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        border: `1.5px solid ${theme.cardBorder}`,
        borderRadius: 20,
        padding: '16px',
        cursor: 'grab',
        userSelect: 'none',
        boxShadow: '0 2px 16px rgba(0,0,0,0.04)',
        transform: `translate3d(${body.x}px, ${body.y}px, 0)`,
        willChange: 'transform',
        transition: 'box-shadow 0.2s, background 0.5s, border-color 1.5s',
      }}
    >
      <div style={{
        fontSize: '16px',
        fontWeight: 600,
        color: theme.text,
        marginBottom: '8px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {sketch.title}
      </div>
      <pre style={{
        fontSize: '15px',
        fontFamily: "'SF Mono', 'Consolas', monospace",
        opacity: 0.35,
        whiteSpace: 'pre-wrap',
        overflow: 'hidden',
        maxHeight: 48,
        margin: '0 0 12px',
        color: theme.text,
      }}>
        {sketch.script.slice(0, 100)}
        {sketch.script.length > 100 ? '...' : ''}
      </pre>
      <div style={{
        display: 'flex',
        gap: '8px',
        fontSize: '15px',
        opacity: 0.3,
        color: theme.text,
      }}>
        <span>{formatDate(sketch.updated_at)}</span>
        {(sketch.like_count ?? 0) > 0 && <span>{sketch.like_count} likes</span>}
        {(sketch.fork_count ?? 0) > 0 && <span>{sketch.fork_count} forks</span>}
      </div>
    </div>
  );
}

// ── Gallery page ──

export function Gallery() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const sfx = useSFX();
  useBackgroundMusic('/Satie-Theme.wav', 0.08);
  const { theme, mode, setMode } = useDayNightCycle();
  const [sketches, setSketches] = useState<Sketch[]>([]);
  const [loading, setLoading] = useState(true);
  const canvasRef = useRef<HTMLDivElement>(null);
  const { bodies, dragging: draggingRef } = usePhysics(sketches.length, canvasRef);

  useEffect(() => {
    getPublicSketches()
      .then(setSketches)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      background: theme.bg,
      transition: 'background 1.5s ease, color 1.5s ease',
      fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
      color: theme.text,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      position: 'relative',
    }}>
      <RiverCanvas mode={mode} />
      {/* Header */}
      <header style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '16px 32px',
        borderBottom: `1px solid ${theme.border}`,
        flexShrink: 0,
      }}>
        {/* Left — theme toggle */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 2 }}>
            {(['light', 'fade', 'dark'] as ThemeMode[]).map(m => (
              <button
                key={m}
                className="theme-toggle-btn"
                onClick={() => { sfx.click(); setMode(m); }}
                onMouseEnter={sfx.hover}
                style={{
                  padding: '2px 7px',
                  fontSize: '16px',
                  fontFamily: "'Inter', system-ui, sans-serif",
                  fontWeight: mode === m ? 600 : 400,
                  background: mode === m ? theme.invertedBg : 'transparent',
                  color: mode === m ? theme.invertedText : theme.text,
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                  opacity: mode === m ? 1 : 0.25,
                  transition: 'all 0.2s',
                  letterSpacing: '0.02em',
                }}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        {/* Center — logo + explore */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '14px' }}>
          <Link to="/" className="header-link" onMouseEnter={sfx.hover} onClick={sfx.click} style={{ textDecoration: 'none', color: theme.text, fontSize: '24px', fontWeight: 700, letterSpacing: '0.06em' }}>
            satie
          </Link>
          <span style={{ fontSize: '16px', fontWeight: 400, opacity: mode === 'fade' ? 0.45 : 0.25 }}>explore</span>
        </div>

        {/* Right — nav link */}
        <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end' }}>
          {user ? (
            <Link to="/" className="header-link" onMouseEnter={sfx.hover} onClick={sfx.click} style={{ fontSize: '16px', color: theme.text, opacity: mode === 'fade' ? 0.45 : 0.25, textDecoration: 'none', fontWeight: 400 }}>
              dashboard
            </Link>
          ) : (
            <Link to="/" className="header-link" onMouseEnter={sfx.hover} onClick={sfx.click} style={{ fontSize: '16px', color: theme.text, opacity: mode === 'fade' ? 0.45 : 0.25, textDecoration: 'none', fontWeight: 400 }}>
              sign in
            </Link>
          )}
        </div>
      </header>

      {/* Floating cards canvas */}
      <div ref={canvasRef} style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {loading && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.4, fontSize: '16px' }}>
            loading...
          </div>
        )}

        {!loading && sketches.length === 0 && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.4, fontSize: '15px' }}>
            No public sketches yet. Be the first to share one.
          </div>
        )}

        {!loading && sketches.map((sketch, i) => {
          if (!bodies[i]) return null;
          return (
            <GalleryCard
              key={sketch.id}
              sketch={sketch}
              body={bodies[i]}
              index={i}
              draggingRef={draggingRef}
              onClick={() => navigate(`/s/${sketch.id}`)}
              sfx={sfx}
              formatDate={formatDate}
              theme={theme}
            />
          );
        })}
      </div>
    </div>
  );
}
