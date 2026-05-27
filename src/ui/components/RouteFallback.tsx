import { useTheme } from '../theme/ThemeContext';
import { Spinner } from './primitives/Spinner';

/**
 * Quiet full-screen fallback shown while a lazy route chunk loads — e.g. a
 * direct visit / refresh on a code-split route (in-app navigations are warmed
 * via routePreload, so this is mostly a safety net).
 */
export function RouteFallback() {
  const { theme } = useTheme();
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: theme.bg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Spinner size={22} style={{ opacity: 0.4 }} />
    </div>
  );
}

/**
 * Shown when a route chunk fails to load even after retry + reload (see
 * lazyWithRetry). Offers a manual reload instead of leaving the app frozen.
 */
export function RouteErrorFallback() {
  const { theme } = useTheme();
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: theme.bg,
        color: theme.text,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
        padding: 24,
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: 16, opacity: 0.7 }}>This page failed to load.</div>
      <div style={{ fontSize: 13, opacity: 0.4, maxWidth: 320, lineHeight: 1.5 }}>
        A newer version of Satie may have just shipped. Reloading should fix it.
      </div>
      <button
        onClick={() => window.location.reload()}
        style={{
          padding: '8px 20px',
          fontSize: 14,
          fontFamily: "'Inter', system-ui, sans-serif",
          fontWeight: 500,
          background: theme.invertedBg,
          color: theme.invertedText,
          border: 'none',
          borderRadius: 8,
          cursor: 'pointer',
        }}
      >
        Reload
      </button>
    </div>
  );
}
