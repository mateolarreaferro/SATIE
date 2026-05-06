import type { CSSProperties } from 'react';
import { useTheme } from '../theme/ThemeContext';

interface Props {
  /** Override absolute positioning. Defaults to bottom-left. */
  position?: CSSProperties;
}

/** Glass pill describing the unified viewport controls. Visible whenever a
 *  3D scene is rendered so users always know how to move. Pointer-events
 *  none — purely informational. */
export function ControlsHint({ position }: Props) {
  const { theme } = useTheme();

  const pill: CSSProperties = {
    position: 'absolute',
    pointerEvents: 'none',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 14px',
    borderRadius: 999,
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    fontFamily: "'Inter', system-ui, sans-serif",
    fontSize: '12px',
    fontWeight: 500,
    letterSpacing: '0.01em',
    background: theme.overlayBg,
    border: `1px solid ${theme.overlayBorder}`,
    color: theme.overlayText,
    boxShadow: '0 2px 12px rgba(0,0,0,0.25)',
    whiteSpace: 'nowrap',
    zIndex: 12,
    ...(position ?? { bottom: 16, left: 20 }),
  };

  const kbd: CSSProperties = {
    fontFamily: "'SF Mono', Consolas, monospace",
    fontSize: '10px',
    fontWeight: 600,
    letterSpacing: '0.05em',
    padding: '2px 6px',
    background: 'rgba(255,255,255,0.14)',
    borderRadius: 4,
    border: `1px solid ${theme.overlayBorder}`,
  };

  const sep = <span style={{ opacity: 0.45 }}>·</span>;

  return (
    <div style={pill}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 11V6a2 2 0 0 0-4 0" />
          <path d="M14 10V4a2 2 0 0 0-4 0v2" />
          <path d="M10 10.5V6a2 2 0 0 0-4 0v8" />
          <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
        </svg>
        <span>drag to look</span>
      </div>
      {sep}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <kbd style={kbd}>WASD</kbd>
        <span>move</span>
      </div>
      {sep}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <kbd style={kbd}>QE</kbd>
        <span>fly</span>
      </div>
      {sep}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ opacity: 0.7 }}>scroll</span>
        <span>zoom</span>
      </div>
      {sep}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ opacity: 0.7 }}>dbl-click</span>
        <span>teleport</span>
      </div>
    </div>
  );
}
