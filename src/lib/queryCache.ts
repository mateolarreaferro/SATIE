/**
 * Tiny TTL'd sessionStorage cache for list queries.
 * Keeps back/forward navigation instant — refetch happens in the background.
 *
 * Two-phase return: `cached(key)` returns whatever's in storage (or null),
 * `cachedQuery(key, ttl, fn)` returns cached if fresh, otherwise awaits fn().
 * Callers that want stale-while-revalidate should use `cached()` for the
 * synchronous read and kick off `cachedQuery()` to refresh in parallel.
 */

interface CacheEntry<T> {
  value: T;
  expires: number;
}

function safeStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

export function readCache<T>(key: string): T | null {
  const s = safeStorage();
  if (!s) return null;
  try {
    const raw = s.getItem(key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry<T>;
    if (Date.now() > entry.expires) {
      s.removeItem(key);
      return null;
    }
    return entry.value;
  } catch {
    return null;
  }
}

export function writeCache<T>(key: string, value: T, ttlMs: number): void {
  const s = safeStorage();
  if (!s) return;
  try {
    s.setItem(key, JSON.stringify({ value, expires: Date.now() + ttlMs } satisfies CacheEntry<T>));
  } catch {
    // sessionStorage full or unavailable — drop silently
  }
}

export function invalidateCache(keyOrPrefix: string, prefix = false): void {
  const s = safeStorage();
  if (!s) return;
  try {
    if (!prefix) {
      s.removeItem(keyOrPrefix);
      return;
    }
    const toRemove: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k && k.startsWith(keyOrPrefix)) toRemove.push(k);
    }
    toRemove.forEach(k => s.removeItem(k));
  } catch {
    // ignore
  }
}

/**
 * Fetch with cache. If the cache has a fresh value, returns it immediately
 * (no network). Otherwise awaits fn() and stores the result.
 */
export async function cachedQuery<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T> {
  const cached = readCache<T>(key);
  if (cached !== null) return cached;
  const value = await fn();
  writeCache(key, value, ttlMs);
  return value;
}
