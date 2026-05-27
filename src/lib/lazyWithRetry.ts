import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

type Factory<T extends ComponentType<any>> = () => Promise<{ default: T }>;

const RELOAD_GUARD_KEY = 'satie-chunk-reload-attempted';

/** sessionStorage that never throws (private-mode / disabled storage safe). */
function safeSession() {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Detect "failed to load a code-split chunk" errors. These come from transient
 * network failures or — most commonly — a redeploy changing chunk hashes while
 * a stale index.html is still loaded in the tab.
 */
function isChunkLoadError(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  return /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i.test(
    msg,
  );
}

/**
 * `React.lazy` with resilience against chunk-load failures:
 *  - retries the dynamic import once (covers transient network blips), then
 *  - if it still fails with a chunk error, forces ONE full reload to fetch the
 *    fresh chunk manifest (the classic stale-deploy fix), guarded by
 *    sessionStorage so we never loop, and
 *  - on success clears the guard so a future stale deploy can reload again.
 *
 * Without this, a failed route import is uncaught and the app appears frozen on
 * the previous page (the URL changes but nothing renders).
 */
export function lazyWithRetry<T extends ComponentType<any>>(
  factory: Factory<T>,
): LazyExoticComponent<T> {
  return lazy(async () => {
    try {
      const mod = await factory();
      safeSession()?.removeItem(RELOAD_GUARD_KEY);
      return mod;
    } catch {
      // One quick retry for a transient failure.
      try {
        const mod = await factory();
        safeSession()?.removeItem(RELOAD_GUARD_KEY);
        return mod;
      } catch (err2) {
        const ss = safeSession();
        if (isChunkLoadError(err2) && ss && !ss.getItem(RELOAD_GUARD_KEY)) {
          ss.setItem(RELOAD_GUARD_KEY, '1');
          window.location.reload();
          // Hold Suspense until the reload tears the page down.
          return new Promise<{ default: T }>(() => {});
        }
        // Already reloaded once (or storage unavailable) — surface to the
        // nearest error boundary instead of silently hanging.
        throw err2;
      }
    }
  });
}

export interface PreloadableComponent<T extends ComponentType<any>>
  extends LazyExoticComponent<T> {
  /** Eagerly fetch the chunk (e.g. on link hover or when idle). */
  preload: Factory<T>;
}

/** Like {@link lazyWithRetry} but also exposes `.preload()` to warm the chunk early. */
export function lazyRoute<T extends ComponentType<any>>(
  factory: Factory<T>,
): PreloadableComponent<T> {
  const Component = lazyWithRetry(factory) as PreloadableComponent<T>;
  Component.preload = factory;
  return Component;
}
