import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import { useDayNightCycle } from '../hooks/useDayNightCycle';
import { LIGHT, DARK, type Theme, type ThemeMode } from './tokens';

export type { Theme, ThemeMode };

/** Storage key — same as the legacy hook's, so values round-trip. */
const STORAGE_KEY = 'satie-theme-mode';

interface ThemeContextValue {
  theme: Theme;
  mode: ThemeMode;
  setMode: (m: ThemeMode) => void;
  /** Collapses 'fade' → 'light' and 'system' → OS pref so consumers can do simple boolean dark checks. */
  resolvedMode: 'light' | 'dark';
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function loadStoredMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'fade' || stored === 'system') {
      return stored;
    }
  } catch {
    /* SSR or storage disabled */
  }
  return 'fade';
}

function getSystemMode(): 'light' | 'dark' {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolveMode(mode: ThemeMode, systemMode: 'light' | 'dark'): 'light' | 'dark' {
  if (mode === 'system') return systemMode;
  if (mode === 'dark') return 'dark';
  // 'light' and 'fade' both render as the light "family" for boolean checks.
  return 'light';
}

/**
 * App-wide theme provider.
 *
 * - Owns the single `useDayNightCycle()` instance for the whole tree (legacy modes
 *   light/dark/fade are delegated to it so the rAF + chime animation only runs once).
 * - Adds a new `'system'` mode that follows `prefers-color-scheme` via matchMedia.
 * - Keeps the existing `STORAGE_KEY` ('satie-theme-mode') so persistence is unchanged.
 * - Sets `--satie-focus` on `<html>` so the global :focus-visible ring matches the theme.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  // Initial mode read from storage. Track separately because it can be 'system',
  // which the legacy hook doesn't know about.
  const [mode, setModeState] = useState<ThemeMode>(() => loadStoredMode());
  const [systemMode, setSystemMode] = useState<'light' | 'dark'>(() => getSystemMode());

  // The legacy hook only understands 'light' | 'dark' | 'fade'. When the app mode
  // is 'system', forward the resolved OS preference to the underlying hook so its
  // theme matches.
  const legacyMode: 'light' | 'dark' | 'fade' = mode === 'system' ? systemMode : mode;
  const { theme: legacyTheme, setMode: setLegacyMode } = useDayNightCycle();

  // Sync the legacy hook's internal mode whenever ours changes.
  useEffect(() => {
    setLegacyMode(legacyMode);
  }, [legacyMode, setLegacyMode]);

  // Listen for OS theme changes (only meaningful when mode === 'system').
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setSystemMode(e.matches ? 'dark' : 'light');
    // Older Safari uses addListener.
    if (mql.addEventListener) {
      mql.addEventListener('change', handler);
      return () => mql.removeEventListener('change', handler);
    }
    mql.addListener(handler);
    return () => mql.removeListener(handler);
  }, []);

  const setMode = useCallback((m: ThemeMode) => {
    try {
      localStorage.setItem(STORAGE_KEY, m);
    } catch {
      /* storage disabled */
    }
    setModeState(m);
  }, []);

  // Pick the theme. For 'system', we want the *static* LIGHT / DARK preset rather
  // than the legacy hook's value (which could be a fade-mode gradient if the user
  // had been on fade before). For everything else, defer to the legacy hook so its
  // pastel drift drives `theme.bg`.
  const theme: Theme = useMemo(() => {
    if (mode === 'system') return systemMode === 'dark' ? DARK : LIGHT;
    return legacyTheme;
  }, [mode, systemMode, legacyTheme]);

  const resolvedMode = resolveMode(mode, systemMode);

  // Push focus-ring color to a CSS variable so global focus-visible styling stays in sync.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.style.setProperty('--satie-focus', theme.focusRing);
  }, [theme.focusRing]);

  const value: ThemeContextValue = useMemo(
    () => ({ theme, mode, setMode, resolvedMode }),
    [theme, mode, setMode, resolvedMode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * Read the active theme.
 *
 * If a `<ThemeProvider>` is mounted above, returns the shared context value.
 * Otherwise falls back to spinning up its own `useDayNightCycle()` instance so
 * pages that haven't been migrated to the provider still work. This lets us
 * migrate consumers file by file without breakage.
 *
 * Note on hooks rules: a component's ancestor tree (and therefore whether a
 * provider is present) is stable across renders, so the conditional branch
 * below is effectively constant per component instance. We still call
 * `useDayNightCycle` unconditionally inside the fallback branch via a child
 * helper hook to keep React's hook-order checker happy when there's no
 * provider; when a provider IS present we never reach that branch.
 */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (ctx) return ctx;
  // Provider not mounted — fall back to a self-contained instance.
  // This branch is stable for any given component (a tree without a provider
  // ancestor will never gain one mid-render), so React's hook-order rules hold.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useStandaloneTheme();
}

/** Self-contained theme reader used as a fallback when no ThemeProvider is mounted. */
function useStandaloneTheme(): ThemeContextValue {
  const { theme, mode, setMode: setLegacyMode } = useDayNightCycle();
  const [systemMode, setSystemMode] = useState<'light' | 'dark'>(() => getSystemMode());

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setSystemMode(e.matches ? 'dark' : 'light');
    if (mql.addEventListener) {
      mql.addEventListener('change', handler);
      return () => mql.removeEventListener('change', handler);
    }
    mql.addListener(handler);
    return () => mql.removeListener(handler);
  }, []);

  // Push focus-ring color to a CSS variable. Safe to do from the fallback too —
  // it's idempotent, and the "winner" is the most recently rendered consumer.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.style.setProperty('--satie-focus', theme.focusRing);
  }, [theme.focusRing]);

  // Adapt the hook's narrow setter (no 'system') to the wider context shape.
  // When the consumer asks for 'system', persist that intent and forward the
  // OS-resolved value to the underlying hook.
  const setMode = useCallback(
    (m: ThemeMode) => {
      if (m === 'system') {
        try {
          localStorage.setItem(STORAGE_KEY, 'system');
        } catch {
          /* storage disabled */
        }
        setLegacyMode(systemMode);
        return;
      }
      setLegacyMode(m);
    },
    [setLegacyMode, systemMode],
  );

  const resolvedMode = resolveMode(mode, systemMode);

  return useMemo(
    () => ({ theme, mode, setMode, resolvedMode }),
    [theme, mode, setMode, resolvedMode],
  );
}
