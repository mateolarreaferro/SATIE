import { useRef, useState, useCallback, useEffect, type ReactNode } from 'react';

const LS_PREFIX = 'satie-panel-';
const SAVE_DELAY = 500;

interface PanelLayout {
  x: number;
  y: number;
  w: number;
  h: number;
}

function loadLayout(id: string | undefined): PanelLayout | null {
  if (!id) return null;
  try {
    const raw = localStorage.getItem(LS_PREFIX + id);
    if (!raw) return null;
    return JSON.parse(raw) as PanelLayout;
  } catch {
    return null;
  }
}

function saveLayout(id: string | undefined, layout: PanelLayout): void {
  if (!id) return;
  localStorage.setItem(LS_PREFIX + id, JSON.stringify(layout));
}

interface PanelProps {
  title?: string;
  children: ReactNode;
  /** Stable ID for persisting layout (e.g. "score", "space"). If omitted, layout is not saved. */
  panelId?: string;
  defaultWidth?: number;
  defaultHeight?: number;
  defaultX?: number;
  defaultY?: number;
  minWidth?: number;
  minHeight?: number;
  resizable?: boolean;
  borderColor?: string;
  compact?: boolean;
}

export function Panel({
  title,
  children,
  panelId,
  defaultWidth = 400,
  defaultHeight = 300,
  defaultX = 20,
  defaultY = 20,
  minWidth = 200,
  minHeight = 150,
  resizable = true,
  borderColor = '#1a3a2a',
  compact = false,
}: PanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const saved = useRef(loadLayout(panelId));
  const [pos, setPos] = useState({ x: saved.current?.x ?? defaultX, y: saved.current?.y ?? defaultY });
  const [size, setSize] = useState({ w: saved.current?.w ?? defaultWidth, h: saved.current?.h ?? defaultHeight });
  const [isDragging, setIsDragging] = useState(false);
  const [resizeEdge, setResizeEdge] = useState<string | null>(null);
  const dragStart = useRef({ mouseX: 0, mouseY: 0, posX: 0, posY: 0, scale: 1 });
  const startRect = useRef({ x: 0, y: 0, w: 0, h: 0, scale: 1 });
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Clamp panel into viewport so it's always reachable (at least 40px visible).
  // Clamp in layout-pixel space to match the ancestor's CSS scale (workspace zoom).
  const clampToViewport = useCallback(() => {
    const margin = 40;
    const el = panelRef.current;
    const rect = el?.getBoundingClientRect();
    const offsetW = el?.offsetWidth ?? 1;
    const scale = rect && offsetW > 0 ? (rect.width / offsetW) || 1 : 1;
    const maxX = window.innerWidth / scale - margin;
    const maxY = window.innerHeight / scale - margin;
    setPos(p => ({
      x: Math.max(-size.w + margin, Math.min(maxX, p.x)),
      y: Math.max(0, Math.min(maxY, p.y)),
    }));
  }, [size.w]);

  // Clamp on mount and window resize
  useEffect(() => {
    clampToViewport();
    const onResize = () => clampToViewport();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [clampToViewport]);

  // Persist layout on change (debounced)
  useEffect(() => {
    if (!panelId) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveLayout(panelId, { x: pos.x, y: pos.y, w: size.w, h: size.h });
    }, SAVE_DELAY);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [panelId, pos.x, pos.y, size.w, size.h]);

  // Read the current CSS transform scale applied by ancestor(s) — needed so
  // screen-pixel mouse deltas map to layout-pixel positions inside the scaled
  // workspace. Without this, panel drag drifts relative to the cursor when the
  // workspace is zoomed.
  const getAncestorScale = useCallback((): number => {
    const el = panelRef.current;
    if (!el) return 1;
    const rect = el.getBoundingClientRect();
    const w = el.offsetWidth;
    if (w <= 0) return 1;
    const s = rect.width / w;
    return s > 0.001 ? s : 1;
  }, []);

  const onDragStart = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-edge]')) return;
    const scale = getAncestorScale();
    dragStart.current = { mouseX: e.clientX, mouseY: e.clientY, posX: pos.x, posY: pos.y, scale };
    // Promote to a composite layer so moves are GPU-only — no layout/repaint.
    const el = panelRef.current;
    if (el) el.style.willChange = 'transform';
    setIsDragging(true);
    e.preventDefault();
  }, [pos, getAncestorScale]);

  const onEdgeStart = useCallback((edge: string) => (e: React.MouseEvent) => {
    const scale = getAncestorScale();
    dragStart.current = { mouseX: e.clientX, mouseY: e.clientY, posX: pos.x, posY: pos.y, scale };
    startRect.current = { x: pos.x, y: pos.y, w: size.w, h: size.h, scale };
    setResizeEdge(edge);
    e.preventDefault();
    e.stopPropagation();
  }, [pos, size, getAncestorScale]);

  useEffect(() => {
    if (!isDragging && !resizeEdge) return;

    // Drag path: apply CSS transform instead of touching left/top. Transforms
    // don't invalidate layout and the element is promoted to its own composite
    // layer (via will-change), so moves are essentially free — no repaint of
    // Monaco/WebGL children. We commit the final position to state on mouseup.
    //
    // Resize path: width/height still change layout (content reflows), so we
    // just write directly to the element and coalesce via rAF.
    let pendingX = pos.x, pendingY = pos.y, pendingW = size.w, pendingH = size.h;
    let rafPending = false;
    const applyStyle = () => {
      rafPending = false;
      const el = panelRef.current;
      if (!el) return;
      if (isDragging) {
        // Panel's own transform composes with the ancestor scale, so we
        // translate in layout-pixel space (pendingX - posX). The visible
        // movement is (pendingX - posX) * ancestorScale = screen-pixel delta.
        el.style.transform = `translate3d(${pendingX - pos.x}px, ${pendingY - pos.y}px, 0)`;
      } else if (resizeEdge) {
        el.style.left = `${pendingX}px`;
        el.style.top = `${pendingY}px`;
        el.style.width = `${pendingW}px`;
        el.style.height = `${pendingH}px`;
      }
    };
    const schedule = () => {
      if (!rafPending) {
        rafPending = true;
        requestAnimationFrame(applyStyle);
      }
    };

    const onMove = (e: MouseEvent) => {
      if (isDragging) {
        const s = dragStart.current.scale;
        // screen delta ÷ scale → layout delta (px in parent's coord system)
        const layoutDx = (e.clientX - dragStart.current.mouseX) / s;
        const layoutDy = (e.clientY - dragStart.current.mouseY) / s;
        const margin = 40;
        // Clamp bounds in layout-pixel space: the workspace extends beyond the
        // viewport when zoom < 1 (width/height = 100/zoom%), so dividing window
        // dimensions by the ancestor scale gives the true clamp range.
        const maxX = window.innerWidth / s - margin;
        const maxY = window.innerHeight / s - margin;
        pendingX = Math.max(-size.w + margin, Math.min(maxX, dragStart.current.posX + layoutDx));
        pendingY = Math.max(0, Math.min(maxY, dragStart.current.posY + layoutDy));
        schedule();
      }
      if (resizeEdge) {
        const s = startRect.current.scale;
        const dx = (e.clientX - dragStart.current.mouseX) / s;
        const dy = (e.clientY - dragStart.current.mouseY) / s;
        const r = startRect.current;

        let newX = r.x, newY = r.y, newW = r.w, newH = r.h;

        if (resizeEdge.includes('e')) newW = Math.max(minWidth, r.w + dx);
        if (resizeEdge.includes('s')) newH = Math.max(minHeight, r.h + dy);
        if (resizeEdge.includes('w')) {
          const dw = Math.min(dx, r.w - minWidth);
          newX = r.x + dw;
          newW = r.w - dw;
        }
        if (resizeEdge.includes('n')) {
          const dh = Math.min(dy, r.h - minHeight);
          newY = r.y + dh;
          newH = r.h - dh;
        }

        pendingX = newX; pendingY = newY; pendingW = newW; pendingH = newH;
        schedule();
      }
    };

    const onUp = () => {
      const el = panelRef.current;
      if (el && isDragging) {
        // Atomically swap transform → left/top so there's no visual jump
        // before React re-renders with the new state.
        el.style.left = `${pendingX}px`;
        el.style.top = `${pendingY}px`;
        el.style.transform = '';
        el.style.willChange = '';
      }
      setPos({ x: pendingX, y: pendingY });
      if (resizeEdge) setSize({ w: pendingW, h: pendingH });
      setIsDragging(false);
      setResizeEdge(null);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    // pos/size intentionally omitted — we capture the starting values at
    // drag/resize start (in dragStart.current / startRect.current) and never
    // re-read them during the move; including them would re-run the effect
    // on every state commit and detach the listeners mid-drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDragging, resizeEdge, minWidth, minHeight]);

  const EDGE = 8;
  const RADIUS = 20;

  const edgeStyle = (cursor: string, extra: React.CSSProperties): React.CSSProperties => ({
    position: 'absolute',
    zIndex: 10,
    cursor,
    ...extra,
  });

  return (
    <div
      ref={panelRef}
      className="satie-panel"
      data-panel-id={panelId}
      style={{
        position: 'absolute',
        left: pos.x,
        top: pos.y,
        width: size.w,
        height: size.h,
        zIndex: 1,
        background: '#faf9f6',
        borderRadius: RADIUS,
        border: `1.5px solid ${borderColor}`,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: '0 2px 20px rgba(0,0,0,0.04)',
      }}
    >
      {/* Title bar */}
      <div
        className="panel-titlebar"
        onMouseDown={onDragStart}
        style={{
          padding: compact ? '6px 14px 3px' : '10px 16px 6px',
          cursor: isDragging ? 'grabbing' : 'grab',
          userSelect: 'none',
          flexShrink: 0,
        }}
      >
        {title && (
          <span style={{
            fontSize: compact ? '10px' : '13px',
            fontWeight: 500,
            color: '#1a3a2a',
            letterSpacing: '0.02em',
            fontFamily: "'Inter', system-ui, sans-serif",
            opacity: compact ? 0.4 : 1,
          }}>
            {title}
          </span>
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {children}
      </div>

      {/* Resize edges — inset to follow the rounded border */}
      {resizable && (<>
        {/* Right */}
        <div data-edge="e" onMouseDown={onEdgeStart('e')}
          style={edgeStyle('ew-resize', {
            top: RADIUS, right: 0, bottom: RADIUS, width: EDGE,
          })} />
        {/* Bottom */}
        <div data-edge="s" onMouseDown={onEdgeStart('s')}
          style={edgeStyle('ns-resize', {
            left: RADIUS, right: RADIUS, bottom: 0, height: EDGE,
          })} />
        {/* Left */}
        <div data-edge="w" onMouseDown={onEdgeStart('w')}
          style={edgeStyle('ew-resize', {
            top: RADIUS, left: 0, bottom: RADIUS, width: EDGE,
          })} />
        {/* Top (below title) */}
        <div data-edge="n" onMouseDown={onEdgeStart('n')}
          style={edgeStyle('ns-resize', {
            left: RADIUS, right: RADIUS, top: 0, height: EDGE,
          })} />
        {/* Corners — rounded arcs */}
        <div data-edge="se" onMouseDown={onEdgeStart('se')}
          style={edgeStyle('nwse-resize', {
            right: 0, bottom: 0, width: RADIUS, height: RADIUS,
            borderRadius: `0 0 ${RADIUS}px 0`,
          })} />
        <div data-edge="sw" onMouseDown={onEdgeStart('sw')}
          style={edgeStyle('nesw-resize', {
            left: 0, bottom: 0, width: RADIUS, height: RADIUS,
            borderRadius: `0 0 0 ${RADIUS}px`,
          })} />
        <div data-edge="ne" onMouseDown={onEdgeStart('ne')}
          style={edgeStyle('nesw-resize', {
            right: 0, top: 0, width: RADIUS, height: RADIUS,
            borderRadius: `0 ${RADIUS}px 0 0`,
          })} />
        <div data-edge="nw" onMouseDown={onEdgeStart('nw')}
          style={edgeStyle('nwse-resize', {
            left: 0, top: 0, width: RADIUS, height: RADIUS,
            borderRadius: `${RADIUS}px 0 0 0`,
          })} />
      </>)}
    </div>
  );
}
