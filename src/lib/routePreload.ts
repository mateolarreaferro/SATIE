/**
 * Route chunk preloading.
 *
 * React Router v7 wraps navigations in `React.startTransition`, so navigating to
 * a `lazy()` route keeps the current screen mounted until the new chunk loads.
 * If the chunk is fetched cold at click time, the page appears frozen (URL
 * changes, nothing renders). Warming the chunk ahead of time — on link hover and
 * during idle — lets the transition commit instantly.
 *
 * The import specifiers below MUST resolve to the same modules `main.tsx`
 * lazy-loads so the browser-cached chunk is reused (no double fetch).
 */

type Importer = () => Promise<unknown>;

// Keyed by route-path prefix.
const importers: Record<string, Importer> = {
  '/editor': () => import('../ui/pages/Editor'),
  '/explore': () => import('../ui/pages/Gallery'),
  '/library': () => import('../ui/pages/Library'),
  '/sketches': () => import('../ui/pages/Dashboard'),
  '/s': () => import('../ui/pages/SketchView'),
  '/u': () => import('../ui/pages/UserProfile'),
};

const warmed = new Set<string>();

/** Longest matching path-prefix key, so `/editor/:id` maps to `/editor`. */
function keyFor(path: string): string | null {
  let best: string | null = null;
  for (const key of Object.keys(importers)) {
    if (path === key || path.startsWith(`${key}/`)) {
      if (!best || key.length > best.length) best = key;
    }
  }
  return best;
}

/**
 * Preload the chunk for a route path. Idempotent and best-effort: a failed
 * warm-up just means the real navigation pays the load cost (and may retry).
 */
export function preloadRoute(path: string): void {
  const key = keyFor(path);
  if (!key || warmed.has(key)) return;
  warmed.add(key);
  importers[key]().catch(() => warmed.delete(key));
}

/**
 * Warm the top-nav route chunks (explore / library / sketches). These are all
 * small now that the heavy 3D views are themselves code-split, so warming them
 * during the splash makes the first tab click instant. Editor is intentionally
 * excluded — it pulls in Three.js (~861KB) and is reached by a deliberate action
 * (opening a sketch), not a top-nav tab, so we let it load on demand.
 */
export function preloadCommonRoutes(): void {
  ['/explore', '/library', '/sketches'].forEach(preloadRoute);
}
