---
title: Performance — code-splitting, preload, graph layout
subsystem: lib
sources:
  - src/lib/lazyWithRetry.ts
  - src/lib/routePreload.ts
  - src/lib/graphLayout.ts
  - src/lib/graphWorker.ts
synced_sha: 182829cee895
synced: 2026-05-31
related: [../ui/layout-nav.md, ../ui/pages.md]
---

## Purpose

Make first paint cheap and first navigation instant: resilient lazy route loading, ahead-of-time chunk warming, and a force-directed 3D layout for the sample knowledge graph.

## Why it exists / responsibilities

Three independent concerns, grouped because they all serve perceived performance:

- **`lazyWithRetry` / `lazyRoute`** — wrap `React.lazy` so a failed code-split import (transient network blip, or stale `index.html` after a redeploy changed chunk hashes) does not leave the app frozen on the previous page. Retry once, then force exactly one full reload to fetch the fresh chunk manifest.
- **`routePreload`** — warm route chunks during dead time (link hover/focus, browser idle, splash) so React Router v7's transition-wrapped navigation commits without a cold fetch.
- **`graphLayout` / `graphWorker`** — pure force-directed simulation (repulsion + edge attraction + center gravity) that positions community samples in 3D by embedding similarity. The worker variant exists to run it off the main thread.

These directly implement the takeaways in [lessons](../../lessons.md) entries #1–#5.

## Mental model

Navigation timeline, and where each piece intervenes:

```
splash / idle ──► preloadCommonRoutes()  (warm explore/library/sketches chunks)
hover/focus a tab ──► preloadRoute(path)  (warm just that chunk)
click ──► React Router startTransition ──► chunk already cached ──► instant commit
                                       └─ chunk cold ──► lazyWithRetry:
                                              try → retry once → one-time reload
```

`graphLayout` is unrelated to routing: `buildGraph` turns samples+embeddings into nodes/edges, then `stepLayout` is iterated by `computeLayout` (main thread) or by `graphWorker` (off-thread) until convergence.

## Key types & functions

**lazyWithRetry**
- `lazyWithRetry(factory)` — [src/lib/lazyWithRetry.ts:39](../../../src/lib/lazyWithRetry.ts#L39). `React.lazy` that on first failure retries the import once; if the retry fails with a chunk-load error and the sessionStorage guard is unset, sets the guard and calls `window.location.reload()`, holding Suspense forever (returns a never-resolving promise) until the page tears down. On success it clears the guard so a future stale deploy can reload again. If already reloaded once (or storage unavailable), it rethrows to the nearest error boundary.
- `lazyRoute(factory)` — [src/lib/lazyWithRetry.ts:76](../../../src/lib/lazyWithRetry.ts#L76). Same, plus a `.preload()` method (the raw factory) to warm the chunk early. Returns `PreloadableComponent<T>`.
- `isChunkLoadError(err)` — [src/lib/lazyWithRetry.ts:21](../../../src/lib/lazyWithRetry.ts#L21). Regex match on error name+message for `ChunkLoadError`, `Loading chunk`, `Failed to fetch dynamically imported module`, etc.
- `safeSession()` — [src/lib/lazyWithRetry.ts:8](../../../src/lib/lazyWithRetry.ts#L8). `window.sessionStorage` or `null` (private-mode safe).
- Guard key `'satie-chunk-reload-attempted'` — [src/lib/lazyWithRetry.ts:5](../../../src/lib/lazyWithRetry.ts#L5).

**routePreload**
- `importers` — [src/lib/routePreload.ts:17](../../../src/lib/routePreload.ts#L17). Map of route-path prefix → dynamic `import()`. Keys: `/editor`, `/explore`, `/library`, `/sketches`, `/s`, `/u`.
- `preloadRoute(path)` — [src/lib/routePreload.ts:43](../../../src/lib/routePreload.ts#L43). Finds the longest matching prefix via `keyFor`, fires the importer once (tracked in a `warmed` Set), and on failure removes it from the set so a later real navigation can retry. Idempotent, best-effort.
- `preloadCommonRoutes()` — [src/lib/routePreload.ts:57](../../../src/lib/routePreload.ts#L57). Warms `/explore`, `/library`, `/sketches`. **Excludes `/editor`** on purpose (it pulls in Three.js ~861 KB and is reached by a deliberate "open a sketch" action, not a top-nav tab).
- `keyFor(path)` — [src/lib/routePreload.ts:29](../../../src/lib/routePreload.ts#L29). Longest matching prefix, so `/editor/:id` maps to `/editor`.

**graphLayout**
- `GraphNode` / `GraphEdge` / `GraphData` — [src/lib/graphLayout.ts:6](../../../src/lib/graphLayout.ts#L6). Node carries `id,x,y,z,size,name,tags,downloadCount`; edge holds `source`/`target` (indices into `nodes`) and `weight` (similarity 0–1).
- `buildGraph(samples, similarityThreshold = 0.65)` — [src/lib/graphLayout.ts:47](../../../src/lib/graphLayout.ts#L47). Seeds nodes at random positions in a 20-unit cube, sets `size = 0.3 + (downloadCount/maxDownloads)*1.2`, then adds an edge for every pair whose cosine similarity exceeds the threshold. Samples with `embedding === null` are skipped for edges.
- `stepLayout(graph, alpha = 0.1)` — [src/lib/graphLayout.ts:85](../../../src/lib/graphLayout.ts#L85). One simulation tick: all-pairs O(n²) repulsion (strength 2.0), per-edge attraction (strength 0.05 × weight × dist), center gravity (0.01), per-node displacement clamp (max 1.0). Returns `true` when mean displacement < 0.001 (stabilized).
- `computeLayout(graph, maxIterations = 300)` — [src/lib/graphLayout.ts:154](../../../src/lib/graphLayout.ts#L154). Runs `stepLayout` up to `maxIterations` with cooling `alpha = 0.3 * 0.95^i`, breaks early on stabilization. Mutates and returns the same `graph`.
- `cosineSimilarity(a, b)` — [src/lib/graphLayout.ts:32](../../../src/lib/graphLayout.ts#L32). Returns 0 when either vector has zero norm.

**graphWorker** (Web Worker)
- `self.onmessage` — [src/lib/graphWorker.ts:22](../../../src/lib/graphWorker.ts#L22). On `{ type: 'compute', samples, threshold }` it `buildGraph`s, then iterates `stepLayout` (same cooling as `computeLayout`, max 300), posting `{ type: 'progress', ... iteration }` every 20 iterations and a final `{ type: 'done', ... }`. Both messages serialize nodes to plain `{id,x,y,z,size,name,tags,downloadCount}` plus the edges array.
- `postProgress(graph, iteration)` — [src/lib/graphWorker.ts:49](../../../src/lib/graphWorker.ts#L49).

## Data flow

**Code-split + preload:**
- `main.tsx` defines every page via `lazyRoute(() => import(...))` and calls `preloadCommonRoutes()` from a mount effect, scheduled through `requestIdleCallback` (fallback: 600 ms `setTimeout`). See [main / routing](../ui/layout-nav.md).
- `Header.tsx` calls `preloadRoute(tab.to)` on `onMouseEnter`/`onFocus` of each nav tab (and explicitly for `/sketches`), warming the chunk before the click.
- `RouteFallback.tsx` is the Suspense/error fallback that pairs with `lazyWithRetry` — it offers a manual reload instead of a frozen app.

**Graph layout:**
- `Library.tsx` ([pages](../ui/pages.md)) calls `buildGraph(graphSamples, 0.6)` then `computeLayout(graph, 200)` **synchronously** on the main thread, then hands the positioned `GraphData` to `SampleGraph.tsx` (which imports the `GraphNode`/`GraphEdge` types for Three.js rendering).
- `graphWorker.ts` imports `buildGraph`/`stepLayout` from `graphLayout`. Note: as of this writing no module instantiates the worker (`new Worker('./graphWorker')`) — it is the off-thread path the docstring describes, available for wiring into Library when the synchronous compute becomes a jank source.

## Invariants & gotchas

- **Route preload specifiers must match `main.tsx` exactly** (same module path) or the browser fetches the chunk twice instead of reusing the warmed cache. See the header comment in `routePreload.ts` and [lessons](../../lessons.md) #3.
- **One reload, never a loop.** The sessionStorage guard is the only thing preventing an infinite reload cycle when a chunk is permanently broken. Don't clear it except on a successful import. ([lessons](../../lessons.md) #1.)
- **The reload path returns a never-resolving promise on purpose** — Suspense must stay pending until `location.reload()` tears the page down; resolving or rejecting would flash a fallback/error first.
- **`/editor` is deliberately excluded from `preloadCommonRoutes`** — warming it would defeat the Three.js code-split. Keep heavy secondary views (the 3D `SampleGraph`) lazy so route chunks stay small. ([lessons](../../lessons.md) #4.)
- **Don't verify bundling by grepping chunk-name strings** — a chunk can reference another's filename in the `__vitePreload` manifest without importing it. Trust `dist/index.html` modulepreload links and the entry's leading `import` statements. ([lessons](../../lessons.md) #2, #5.)
- **`stepLayout` is O(n²)** in repulsion; fine for a few hundred samples on the main thread but the reason `graphWorker` exists for larger graphs.
- **`buildGraph` mutates nothing but seeds positions with `Math.random()`** — layout is non-deterministic across loads.
- **Edges are skipped for samples without embeddings**; a sample with `embedding: null` still appears as a node but is connected only by repulsion/gravity.

## Change checklist

- Add/rename a code-split route → update `importers` in `routePreload.ts`, the `lazyRoute(...)` in `main.tsx`, and (if it's a top-nav tab to warm during splash) `preloadCommonRoutes`.
- Change a chunk-load error message in a new bundler version → update the `isChunkLoadError` regex.
- Tune the layout (forces, thresholds, iterations, cooling) → change both `computeLayout` (main thread) and the inline loop in `graphWorker.ts` to keep them consistent.
- Change the `GraphNode`/`GraphEdge` shape → update the worker's two serialization maps (`postMessage` in `onmessage` and `postProgress`) and `SampleGraph.tsx`'s rendering.
- Per the wiki gate: editing any source file below updates this page in the same commit.

## Sources

- src/lib/lazyWithRetry.ts
- src/lib/routePreload.ts
- src/lib/graphLayout.ts
- src/lib/graphWorker.ts
