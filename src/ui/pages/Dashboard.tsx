import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/AuthContext';
import { getUserSketches, createSketch, deleteSketch, updateSketch } from '../../lib/sketches';
import { TEMPLATES } from '../../lib/templates';
import type { Sketch } from '../../lib/supabase';
import { SplashScreen } from '../components/SplashScreen';
import { Header } from '../components/Header';
import { useSFX } from '../hooks/useSFX';
import { useDayNightCycle, type Theme } from '../hooks/useDayNightCycle';
import { useBackgroundMusic } from '../hooks/useBackgroundMusic';
import { RiverCanvas } from '../components/RiverCanvas';

// ── Physics body for each sketch card ──

interface PhysicsBody {
  x: number; y: number;
  vx: number; vy: number;
  w: number; h: number;
  colliding: boolean; // true during collision frame (triggers animation)
}

const CARD_W = 280;
const CARD_H = 160;
const DRIFT_SPEED = 0.08; // pixels per frame — very gentle
const DAMPING = 0.9995; // very slow decay — cards keep drifting
const BOUNCE = 0.4;
const COLLISION_PUSH = 0.6;

/** Shared AudioContext for collision sounds — avoids creating/destroying per collision */
let _collisionCtx: AudioContext | null = null;
function getCollisionCtx(): AudioContext {
  if (!_collisionCtx || _collisionCtx.state === 'closed') _collisionCtx = new AudioContext();
  if (_collisionCtx.state === 'suspended') _collisionCtx.resume();
  return _collisionCtx;
}

/** Collision sound — short pitched tap, pitch varies with impact speed */
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
    const vol = Math.min(0.075, 0.0125 + speed * 0.0375);
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.03);

    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start();
    source.stop(ctx.currentTime + 0.03);
  } catch { /* audio not available */ }
}

function usePhysics(count: number, containerRef: React.RefObject<HTMLDivElement | null>) {
  const bodies = useRef<PhysicsBody[]>([]);
  const raf = useRef(0);
  const dragging = useRef<number>(-1);
  /** Cached container size — updated on resize, not every frame */
  const containerSize = useRef({ w: 1200, h: 600 });

  // Track container size via ResizeObserver instead of per-frame getBoundingClientRect
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
    // Initial measurement
    const rect = el.getBoundingClientRect();
    containerSize.current.w = rect.width;
    containerSize.current.h = rect.height;
    return () => ro.disconnect();
  }, [containerRef]);

  // Initialize bodies when count changes
  useEffect(() => {
    const cw = containerSize.current.w;
    const ch = containerSize.current.h;
    const margin = 40;

    const newBodies: PhysicsBody[] = [];
    for (let i = 0; i < count; i++) {
      const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
      const col = i % cols;
      const row = Math.floor(i / cols);
      const cellW = (cw - margin * 2) / cols;
      const cellH = (ch - margin * 2) / Math.ceil(count / cols);

      newBodies.push({
        x: margin + col * cellW + (cellW - CARD_W) / 2 + (Math.random() - 0.5) * 30,
        y: margin + row * cellH + (cellH - CARD_H) / 2 + (Math.random() - 0.5) * 20,
        vx: (Math.random() - 0.5) * DRIFT_SPEED * 2,
        vy: (Math.random() - 0.5) * DRIFT_SPEED * 2,
        w: CARD_W,
        h: CARD_H,
        colliding: false,
      });
    }
    bodies.current = newBodies;
  }, [count]);

  // Physics loop — delta-time based for frame-rate independence
  useEffect(() => {
    let lastCollisionTime = 0;
    let lastFrameTime = performance.now();

    const step = () => {
      const cw = containerSize.current.w;
      const ch = containerSize.current.h;
      if (cw === 0) { raf.current = requestAnimationFrame(step); return; }
      const bs = bodies.current;
      const now = performance.now();
      const dt = Math.min((now - lastFrameTime) / 16.667, 3); // normalized to 60fps, capped at 3x
      lastFrameTime = now;

      for (let i = 0; i < bs.length; i++) {
        const b = bs[i];
        const isDragged = i === dragging.current;
        b.colliding = false;

        if (!isDragged) {
          b.x += b.vx * dt;
          b.y += b.vy * dt;

          // Damping (frame-rate independent)
          const dampFactor = Math.pow(DAMPING, dt);
          b.vx *= dampFactor;
          b.vy *= dampFactor;

          // Keep minimum drift
          const speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
          if (speed < DRIFT_SPEED * 0.3) {
            const angle = Math.random() * Math.PI * 2;
            b.vx += Math.cos(angle) * DRIFT_SPEED * 0.05;
            b.vy += Math.sin(angle) * DRIFT_SPEED * 0.05;
          }
        }

        // Wall collisions (skip for dragged card — user has control)
        if (!isDragged) {
          const MIN_BOUNCE = 0.15;
          if (b.x < 0) {
            b.x = 0;
            b.vx = Math.max(MIN_BOUNCE, Math.abs(b.vx) * BOUNCE);
            b.colliding = true;
          }
          if (b.y < 0) {
            b.y = 0;
            b.vy = Math.max(MIN_BOUNCE, Math.abs(b.vy) * BOUNCE);
            b.colliding = true;
          }
          if (b.x + b.w > cw) {
            b.x = cw - b.w;
            b.vx = -Math.max(MIN_BOUNCE, Math.abs(b.vx) * BOUNCE);
            b.colliding = true;
          }
          if (b.y + b.h > ch) {
            b.y = ch - b.h;
            b.vy = -Math.max(MIN_BOUNCE, Math.abs(b.vy) * BOUNCE);
            b.colliding = true;
          }
          // Hard clamp — never leave bounds
          b.x = Math.max(0, Math.min(cw - b.w, b.x));
          b.y = Math.max(0, Math.min(ch - b.h, b.y));
        }

        // Card-to-card collisions (AABB)
        for (let j = i + 1; j < bs.length; j++) {
          const o = bs[j];
          const overlapX = Math.min(b.x + b.w, o.x + o.w) - Math.max(b.x, o.x);
          const overlapY = Math.min(b.y + b.h, o.y + o.h) - Math.max(b.y, o.y);

          if (overlapX > 0 && overlapY > 0) {
            b.colliding = true;
            o.colliding = true;

            const bDragged = i === dragging.current;
            const oDragged = j === dragging.current;

            // Separate along smallest overlap axis
            if (overlapX < overlapY) {
              const sign = b.x < o.x ? -1 : 1;
              if (bDragged) {
                // Dragged card pushes the other fully
                o.x -= sign * overlapX;
                o.vx = -sign * Math.max(1.5, Math.abs(b.vx) + 1) * COLLISION_PUSH;
              } else if (oDragged) {
                b.x += sign * overlapX;
                b.vx = sign * Math.max(1.5, Math.abs(o.vx) + 1) * COLLISION_PUSH;
              } else {
                b.x += sign * overlapX * 0.5;
                o.x -= sign * overlapX * 0.5;
                const tmpVx = b.vx;
                b.vx = o.vx * COLLISION_PUSH;
                o.vx = tmpVx * COLLISION_PUSH;
              }
            } else {
              const sign = b.y < o.y ? -1 : 1;
              if (bDragged) {
                o.y -= sign * overlapY;
                o.vy = -sign * Math.max(1.5, Math.abs(b.vy) + 1) * COLLISION_PUSH;
              } else if (oDragged) {
                b.y += sign * overlapY;
                b.vy = sign * Math.max(1.5, Math.abs(o.vy) + 1) * COLLISION_PUSH;
              } else {
                b.y += sign * overlapY * 0.5;
                o.y -= sign * overlapY * 0.5;
                const tmpVy = b.vy;
                b.vy = o.vy * COLLISION_PUSH;
                o.vy = tmpVy * COLLISION_PUSH;
              }
            }

            // Collision sound (throttled)
            const impactSpeed = Math.sqrt(
              (b.vx - o.vx) ** 2 + (b.vy - o.vy) ** 2
            );
            if (now - lastCollisionTime > 80) {
              lastCollisionTime = now;
              collisionSound(impactSpeed);
            }
          }
        }
      }

      // Update DOM directly — no React re-render for smooth 60fps
      // translate3d triggers GPU compositing for smoother animation
      const cards = containerRef.current?.querySelectorAll<HTMLDivElement>('.sketch-card');
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

// ── Sketch card (positioned by physics) ──

function SketchCard({
  sketch,
  body,
  index,
  draggingRef,
  onOpen,
  onDelete,
  onRename,
  sfx,
  theme,
}: {
  sketch: Sketch;
  body: PhysicsBody;
  index: number;
  draggingRef: React.MutableRefObject<number>;
  onOpen: () => void;
  onDelete: () => void;
  onRename: (title: string) => void;
  sfx: ReturnType<typeof useSFX>;
  theme: Theme;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(sketch.title);
  const inputRef = useRef<HTMLInputElement>(null);
  const totalDist = useRef(0);

  useEffect(() => {
    if (editing && inputRef.current) inputRef.current.focus();
  }, [editing]);

  const onDragStart = useCallback((e: React.MouseEvent) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'BUTTON') return;
    e.preventDefault();

    const startX = e.clientX;
    const startY = e.clientY;
    const offsetX = e.clientX - body.x;
    const offsetY = e.clientY - body.y;
    let lastMx = 0, lastMy = 0;
    totalDist.current = 0;
    draggingRef.current = index;

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      totalDist.current = Math.sqrt(dx * dx + dy * dy);
      body.x = ev.clientX - offsetX;
      body.y = ev.clientY - offsetY;
      body.vx = 0;
      body.vy = 0;
      lastMx = ev.movementX || 0;
      lastMy = ev.movementY || 0;
    };

    const onUp = () => {
      draggingRef.current = -1;
      // Flick velocity
      body.vx = lastMx * 0.4;
      body.vy = lastMy * 0.4;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [body, index, draggingRef]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'BUTTON' || tag === 'INPUT') return;
    // Only open if the mouse barely moved (< 5px) — otherwise it was a drag
    if (totalDist.current > 5) return;
    sfx.open();
    onOpen();
  }, [onOpen, sfx]);

  const commitRename = () => {
    setEditing(false);
    const trimmed = title.trim() || 'Untitled';
    setTitle(trimmed);
    if (trimmed !== sketch.title) onRename(trimmed);
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <div
      className="sketch-card"
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
        zIndex: 1,
      }}
    >
      {/* Title — double click to edit */}
      {editing ? (
        <input
          ref={inputRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') { setTitle(sketch.title); setEditing(false); } }}
          style={{
            fontSize: '16px',
            fontWeight: 600,
            color: theme.text,
            fontFamily: "'Inter', system-ui, sans-serif",
            border: 'none',
            borderBottom: `1.5px solid ${theme.text}`,
            background: 'transparent',
            outline: 'none',
            width: '100%',
            padding: '0 0 2px',
            marginBottom: '8px',
          }}
        />
      ) : (
        <div
          onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }}
          style={{
            fontSize: '16px',
            fontWeight: 600,
            marginBottom: '8px',
            color: theme.text,
          }}
        >
          {title}
        </div>
      )}

      {/* Preview */}
      <pre style={{
        fontSize: '15px',
        fontFamily: "'SF Mono', 'Consolas', monospace",
        opacity: theme.mode === 'fade' ? 0.55 : 0.4,
        whiteSpace: 'pre-wrap',
        overflow: 'hidden',
        maxHeight: 60,
        margin: '0 0 12px',
        color: theme.text,
      }}>
        {sketch.script.slice(0, 120)}
        {sketch.script.length > 120 ? '...' : ''}
      </pre>

      {/* Meta */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        fontSize: '15px',
        opacity: theme.mode === 'fade' ? 0.5 : 0.35,
        color: theme.text,
      }}>
        <span>{formatDate(sketch.updated_at)}</span>
        {sketch.is_public && (
          <span style={{
            background: theme.text,
            color: theme.invertedText,
            padding: '1px 6px',
            borderRadius: 4,
            fontSize: '11px',
          }}>
            public
          </span>
        )}
        <button
          className="delete-btn"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); sfx.del(); onDelete(); }}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: '15px',
            color: theme.mode === 'dark' ? '#e8e6e1' : theme.text,
            opacity: theme.mode === 'dark' ? 0.3 : 0.4,
            marginLeft: 'auto',
            fontFamily: "'Inter', system-ui, sans-serif",
          }}
        >
          delete
        </button>
      </div>
    </div>
  );
}

export function Dashboard() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const sfx = useSFX();
  useBackgroundMusic('/Satie-Theme.wav', 0.08);
  const { theme, mode, setMode } = useDayNightCycle();
  const canvasRef = useRef<HTMLDivElement>(null);
  const [sketches, setSketches] = useState<Sketch[]>([]);
  const [loadingSketches, setLoadingSketches] = useState(false);
  const [showSplash, setShowSplash] = useState(() => {
    if (localStorage.getItem('satie-onboarding-done')) return false;
    return true;
  });
  const handleSplashComplete = useCallback(() => {
    setShowSplash(false);
    localStorage.setItem('satie-onboarding-done', '1');
  }, []);

  // Physics simulation for sketch cards
  const { bodies, dragging: draggingRef } = usePhysics(sketches.length, canvasRef);

  const fetchSketches = useCallback(async () => {
    if (!user) return;
    setLoadingSketches(true);
    try {
      const data = await getUserSketches(user.id);
      setSketches(data);
    } catch (err) {
      console.error('Failed to load sketches:', err);
    } finally {
      setLoadingSketches(false);
    }
  }, [user]);

  useEffect(() => {
    fetchSketches();
  }, [fetchSketches]);

  const handleNew = useCallback(async () => {
    if (!user) {
      navigate('/editor');
      return;
    }
    try {
      const sketch = await createSketch(user.id, 'Untitled', '# satie\n');
      navigate(`/editor/${sketch.id}`);
    } catch (err) {
      console.error('Failed to create sketch:', err);
    }
  }, [user, navigate]);

  const handleNewFromTemplate = useCallback(async (title: string, script: string) => {
    if (!user) {
      // Guest mode: navigate to editor with template in URL state
      navigate('/editor', { state: { templateTitle: title, templateScript: script } });
      return;
    }
    try {
      const sketch = await createSketch(user.id, title, script);
      navigate(`/editor/${sketch.id}`);
    } catch (err) {
      console.error('Failed to create sketch from template:', err);
    }
  }, [user, navigate]);

  const handleDelete = useCallback(async (id: string) => {
    try {
      await deleteSketch(id);
      setSketches(prev => prev.filter(s => s.id !== id));
    } catch (err) {
      console.error('Failed to delete sketch:', err);
    }
  }, []);

  const handleRename = useCallback(async (id: string, title: string) => {
    try {
      await updateSketch(id, { title });
      setSketches(prev => prev.map(s => s.id === id ? { ...s, title } : s));
    } catch (err) {
      console.error('Failed to rename sketch:', err);
    }
  }, []);

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.loadingText}>loading...</div>
      </div>
    );
  }

  return (
    <>
      {showSplash && <SplashScreen onComplete={handleSplashComplete} />}

      <div style={{ ...styles.container, background: theme.bg, color: theme.text, transition: 'background 1.5s ease, color 1.5s ease', position: 'relative' }}>
        <RiverCanvas mode={mode} />
        <Header theme={theme} mode={mode} setMode={setMode} />

        {/* Canvas area — sketches float with physics */}
        <div ref={canvasRef} style={styles.canvas}>
          {/* New sketch button — top left of canvas */}
          {user && (
            <button
              className="new-btn"
              onClick={() => { sfx.click(); handleNew(); }}
              onMouseEnter={sfx.hover}
              style={{ ...styles.newBtn, background: theme.invertedBg, color: theme.invertedText, transition: 'background 0.3s, color 0.3s' }}
            >
              + New Sketch
            </button>
          )}

          {!user && (
            <div style={styles.welcome}>
              <div style={styles.welcomeTitle}>Welcome to Satie</div>
              <p style={styles.welcomeSubtitle}>
                Sign in to save and revisit your compositions, or start a new sketch as a guest.
              </p>
              <button className="welcome-btn" onClick={() => { sfx.click(); handleNew(); }} onMouseEnter={sfx.hover} style={{ ...styles.welcomeBtn, background: theme.invertedBg, color: theme.invertedText, transition: 'background 0.3s, color 0.3s' }}>
                Open Editor
              </button>
            </div>
          )}

          {user && loadingSketches && (
            <div style={styles.loadingText}>loading sketches...</div>
          )}

          {user && !loadingSketches && sketches.length === 0 && (
            <div style={styles.welcome}>
              <div style={styles.welcomeTitle}>No sketches yet</div>
              <p style={styles.welcomeSubtitle}>Create your first composition, or start from a template.</p>
            </div>
          )}

          {/* Templates — shown when user has no sketches or is new */}
          {((!user) || (user && !loadingSketches && sketches.length < 3)) && (
            <div style={{
              position: 'absolute',
              bottom: 24,
              left: '50%',
              transform: 'translateX(-50%)',
              display: 'flex',
              gap: '10px',
              flexWrap: 'wrap',
              justifyContent: 'center',
              maxWidth: '90%',
            }}>
              <div style={{
                width: '100%',
                textAlign: 'center',
                fontSize: '16px',
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
                opacity: 0.3,
                fontWeight: 600,
                marginBottom: 2,
                fontFamily: "'Inter', system-ui, sans-serif",
              }}>Templates</div>
              {TEMPLATES.map((tmpl) => (
                <button
                  key={tmpl.title}
                  className="template-btn"
                  onClick={() => { sfx.click(); handleNewFromTemplate(tmpl.title, tmpl.script); }}
                  onMouseEnter={sfx.hover}
                  style={{
                    padding: '6px 12px',
                    background: theme.mode === 'dark' ? 'rgba(26,25,24,0.7)' : theme.mode === 'fade' ? 'rgba(255,255,255,0.2)' : 'rgba(250,249,246,0.6)',
                    border: `1px solid ${theme.cardBorder}`,
                    borderRadius: 8,
                    cursor: 'pointer',
                    fontFamily: "'Inter', system-ui, sans-serif",
                    fontSize: '15px',
                    color: theme.text,
                    transition: 'all 0.15s, background 0.5s, border-color 1.5s, color 1.5s',
                    backdropFilter: 'blur(12px)',
                    WebkitBackdropFilter: 'blur(12px)',
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: '15px' }}>{tmpl.title}</div>
                  <div style={{ fontSize: '16px', opacity: 0.4, marginTop: 1 }}>{tmpl.description}</div>
                </button>
              ))}
            </div>
          )}

          {user && sketches.map((sketch, i) => {
            if (!bodies[i]) return null;
            return (
              <SketchCard
                key={sketch.id}
                sketch={sketch}
                body={bodies[i]}
                index={i}
                draggingRef={draggingRef}
                theme={theme}
                onOpen={() => navigate(`/editor/${sketch.id}`)}
                onDelete={() => handleDelete(sketch.id)}
                onRename={(title) => handleRename(sketch.id, title)}
                sfx={sfx}
              />
            );
          })}
        </div>
      </div>
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: '100vw',
    height: '100vh',
    background: '#f4f3ee',
    fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
    color: '#0a0a0a',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  newBtn: {
    position: 'absolute' as const,
    top: 28,
    left: 32,
    padding: '7px 18px',
    background: '#0a0a0a',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: '16px',
    fontFamily: "'Inter', system-ui, sans-serif",
    color: '#faf9f6',
    fontWeight: 500,
    zIndex: 10,
  },
  canvas: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
  },
  welcome: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    textAlign: 'center' as const,
  },
  welcomeTitle: {
    fontSize: '18px',
    fontWeight: 600,
    marginBottom: '8px',
  },
  welcomeSubtitle: {
    fontSize: '15px',
    opacity: 0.5,
    marginBottom: '20px',
  },
  welcomeBtn: {
    padding: '8px 24px',
    background: '#0a0a0a',
    border: 'none',
    borderRadius: 10,
    cursor: 'pointer',
    fontSize: '15px',
    fontFamily: "'Inter', system-ui, sans-serif",
    color: '#faf9f6',
    fontWeight: 500,
  },
  loadingText: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    fontSize: '16px',
    opacity: 0.4,
  },
};
