import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getPublicSketches } from '../../lib/sketches';
import { useSFX } from '../hooks/useSFX';
import { useDayNightCycle, type Theme } from '../hooks/useDayNightCycle';
import { useBackgroundMusic } from '../hooks/useBackgroundMusic';
import { RiverCanvas } from '../components/RiverCanvas';
import { Header } from '../components/Header';
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
const CARD_GAP = 24;
const GRID_PAD = 20;
const GRID_COLS = 4;

/** Shared AudioContext for collision sounds — created lazily on first user gesture */
let _collisionCtx: AudioContext | null = null;
function getCollisionCtx(): AudioContext | null {
  try {
    if (!_collisionCtx || _collisionCtx.state === 'closed') _collisionCtx = new AudioContext();
    if (_collisionCtx.state === 'suspended') _collisionCtx.resume();
    return _collisionCtx;
  } catch {
    return null;
  }
}

function collisionSound(speed: number) {
  try {
    const ctx = getCollisionCtx();
    if (!ctx) return;
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

function usePhysics(count: number, version: number, containerRef: React.RefObject<HTMLDivElement | null>) {
  const bodies = useRef<PhysicsBody[]>([]);
  const raf = useRef(0);
  const dragging = useRef(-1);
  const containerSize = useRef({ w: 1200, h: 600 });
  const [, setVersion] = useState(0);

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
    const cols = Math.min(GRID_COLS, Math.max(1, Math.floor((cw - GRID_PAD * 2 + CARD_GAP) / (CARD_W + CARD_GAP))));
    const rows = Math.ceil(count / cols);
    const totalW = cols * CARD_W + (cols - 1) * CARD_GAP;
    const offsetX = (cw - totalW) / 2;

    const newBodies: PhysicsBody[] = [];
    for (let i = 0; i < count; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      newBodies.push({
        x: offsetX + col * (CARD_W + CARD_GAP) + (Math.random() - 0.5) * 10,
        y: GRID_PAD + row * (CARD_H + CARD_GAP) + (Math.random() - 0.5) * 8,
        vx: (Math.random() - 0.5) * 0.08,
        vy: (Math.random() - 0.5) * 0.08,
        w: CARD_W, h: CARD_H, colliding: false,
      });
    }
    // Update container height to fit all rows
    const neededH = GRID_PAD * 2 + rows * CARD_H + (rows - 1) * CARD_GAP;
    containerSize.current.h = Math.max(containerSize.current.h, neededH);
    const el = containerRef.current;
    if (el) el.style.minHeight = `${neededH}px`;

    bodies.current = newBodies;
    setVersion(v => v + 1);
  }, [count, version]);

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
  }, [count, version]);

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

const INITIAL_VISIBLE = 8;

type TabKey = 'all' | 'liked' | 'forked';

export function Gallery() {
  const navigate = useNavigate();
  const sfx = useSFX();
  useBackgroundMusic('/Satie-Theme.wav', 0.08);
  const { theme, mode, setMode } = useDayNightCycle();
  const [allSketches, setAllSketches] = useState<Sketch[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<TabKey>('all');
  const canvasRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getPublicSketches()
      .then(setAllSketches)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // Filter by search
  const searched = (() => {
    if (!search.trim()) return allSketches;
    const q = search.toLowerCase().trim();
    return allSketches.filter(s =>
      (s.title ?? '').toLowerCase().includes(q) ||
      (s.script ?? '').toLowerCase().includes(q)
    );
  })();

  // Tab filtering
  const tabSketches = (() => {
    switch (tab) {
      case 'liked': return searched.filter(s => (s.like_count ?? 0) > 0).sort((a, b) => (b.like_count ?? 0) - (a.like_count ?? 0));
      case 'forked': return searched.filter(s => (s.fork_count ?? 0) > 0).sort((a, b) => (b.fork_count ?? 0) - (a.fork_count ?? 0));
      default: return [...searched].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
    }
  })();

  // For "all" tab: split into initial viewport + overflow
  const isAllTab = tab === 'all' && !search.trim();
  const visibleSketches = isAllTab ? tabSketches.slice(0, INITIAL_VISIBLE) : tabSketches;
  const overflowSketches = isAllTab ? tabSketches.slice(INITIAL_VISIBLE) : [];

  // Version key so physics reinits when the filtered set changes
  const sketchKey = visibleSketches.map(s => s.id).join(',');
  const [physicsVersion, setPhysicsVersion] = useState(0);
  const lastKeyRef = useRef(sketchKey);
  if (lastKeyRef.current !== sketchKey) {
    lastKeyRef.current = sketchKey;
    setPhysicsVersion(v => v + 1);
  }
  const { bodies, dragging: draggingRef } = usePhysics(visibleSketches.length, physicsVersion, canvasRef);

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  // Tab config
  const tabs: { key: TabKey; label: string; count: number }[] = [
    { key: 'all', label: 'all', count: searched.length },
    { key: 'liked', label: 'liked', count: searched.filter(s => (s.like_count ?? 0) > 0).length },
    { key: 'forked', label: 'forked', count: searched.filter(s => (s.fork_count ?? 0) > 0).length },
  ];

  return (
    <div ref={scrollRef} style={{
      width: '100vw',
      height: '100vh',
      background: theme.bg,
      transition: 'background 1.5s ease, color 1.5s ease',
      fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
      color: theme.text,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'auto',
      position: 'relative',
    }}>
      <RiverCanvas mode={mode} />
      <Header theme={theme} mode={mode} setMode={setMode} />

      {/* Search + tabs bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 20px',
        position: 'relative',
        zIndex: 10,
      }}>
        {/* Search input */}
        <div style={{ position: 'relative', flex: 1, maxWidth: 320 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={theme.text} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', opacity: 0.3 }}>
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            placeholder="search sketches..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 12px 8px 34px',
              fontSize: '14px',
              fontFamily: "'Inter', system-ui, sans-serif",
              background: theme.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
              border: `1px solid ${theme.mode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'}`,
              borderRadius: 10,
              color: theme.text,
              outline: 'none',
            }}
          />
        </div>

        {/* Tab buttons */}
        <div style={{ display: 'flex', gap: 4 }}>
          {tabs.map(({ key, label, count }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              style={{
                padding: '6px 14px',
                fontSize: '13px',
                fontFamily: "'Inter', system-ui, sans-serif",
                background: tab === key
                  ? (theme.mode === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)')
                  : 'transparent',
                border: `1px solid ${tab === key
                  ? (theme.mode === 'dark' ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)')
                  : 'transparent'}`,
                borderRadius: 8,
                color: theme.text,
                opacity: tab === key ? 0.9 : 0.4,
                cursor: 'pointer',
                fontWeight: tab === key ? 600 : 400,
                transition: 'all 0.15s',
              }}
            >
              {label}{count > 0 && key !== 'all' ? ` (${count})` : ''}
            </button>
          ))}
        </div>

        {/* Result count when searching */}
        {search.trim() && (
          <span style={{ fontSize: '13px', opacity: 0.3 }}>
            {tabSketches.length} result{tabSketches.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Physics canvas — first viewport of cards */}
      <div ref={canvasRef} style={{ flex: 1, position: 'relative', overflow: 'visible', flexShrink: 0 }}>
        {loading && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.4, fontSize: '16px' }}>
            loading...
          </div>
        )}

        {!loading && tabSketches.length === 0 && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.4, fontSize: '15px' }}>
            {allSketches.length === 0
              ? 'No public sketches yet. Be the first to share one.'
              : tab === 'liked' ? 'No liked sketches yet.'
              : tab === 'forked' ? 'No forked sketches yet.'
              : 'No sketches match your search.'}
          </div>
        )}

        {!loading && visibleSketches.map((sketch, i) => {
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

      {/* Scroll-down indicator + overflow cards (all tab only) */}
      {overflowSketches.length > 0 && (
        <>
          {/* Scroll hint */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            padding: '12px 0 8px',
            opacity: 0.2,
            animation: 'satie-bounce 2s ease-in-out infinite',
            cursor: 'pointer',
            flexShrink: 0,
            position: 'relative',
            zIndex: 10,
          }}
          onClick={() => {
            const el = document.getElementById('gallery-overflow');
            el?.scrollIntoView({ behavior: 'smooth' });
          }}
          >
            <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600, marginBottom: 4 }}>
              {overflowSketches.length} more sketch{overflowSketches.length !== 1 ? 'es' : ''}
            </div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={theme.text} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </div>

          {/* Overflow grid */}
          <div id="gallery-overflow" style={{
            flexShrink: 0,
            padding: '40px 24px 80px',
            display: 'grid',
            gridTemplateColumns: `repeat(${GRID_COLS}, ${CARD_W}px)`,
            gap: CARD_GAP,
            justifyContent: 'center',
            position: 'relative',
            zIndex: 5,
          }}>
            {overflowSketches.map(sketch => (
              <div
                key={sketch.id}
                className="gallery-card"
                onClick={() => { sfx.open(); navigate(`/s/${sketch.id}`); }}
                onMouseEnter={sfx.hover}
                style={{
                  width: CARD_W,
                  background: theme.mode === 'dark' ? 'rgba(26,25,24,0.75)' : theme.mode === 'fade' ? 'rgba(255,255,255,0.25)' : 'rgba(250,249,246,0.65)',
                  backdropFilter: 'blur(12px)',
                  WebkitBackdropFilter: 'blur(12px)',
                  border: `1.5px solid ${theme.cardBorder}`,
                  borderRadius: 20,
                  padding: '16px',
                  cursor: 'pointer',
                  userSelect: 'none',
                  boxShadow: '0 2px 16px rgba(0,0,0,0.04)',
                  transition: 'box-shadow 0.2s, transform 0.15s',
                }}
              >
                <div style={{ fontSize: '16px', fontWeight: 600, color: theme.text, marginBottom: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {sketch.title}
                </div>
                <pre style={{ fontSize: '15px', fontFamily: "'SF Mono', 'Consolas', monospace", opacity: 0.35, whiteSpace: 'pre-wrap', overflow: 'hidden', maxHeight: 48, margin: '0 0 12px', color: theme.text }}>
                  {sketch.script.slice(0, 100)}{sketch.script.length > 100 ? '...' : ''}
                </pre>
                <div style={{ display: 'flex', gap: 8, fontSize: '15px', opacity: 0.3, color: theme.text }}>
                  <span>{formatDate(sketch.updated_at)}</span>
                  {(sketch.like_count ?? 0) > 0 && <span>{sketch.like_count} likes</span>}
                  {(sketch.fork_count ?? 0) > 0 && <span>{sketch.fork_count} forks</span>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
