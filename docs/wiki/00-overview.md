---
title: Satie — System Overview
subsystem: meta
sources: []
synced_sha: n/a
synced: 2026-05-30
related: [_conventions.md]
---

# Satie — System Overview

Satie is a domain-specific language for **spatial audio composition in the browser**.
Users write plaintext `.satie` scripts that spawn sound voices positioned in 3D space
with DSP effects, interpolation, and live visual feedback.

This page is the front door to the wiki — the natural-language mirror of the system.
For how the wiki itself works, see [`_conventions.md`](./_conventions.md).

---

## The shape of the system

```
 .satie script ──▶ Parser ──▶ Statement[] ──▶ Engine ──▶ Web Audio graph ──▶ speakers
   (text)         (regex)     (data)        (runtime)    (nodes + panner)
                                               │
                                               ▼
                                          tracksRef ──▶ SpatialViewport (Three.js)
```

Three subsystems, one strict boundary:

- **`engine/`** — a pure Web Audio runtime with **zero React**. Parses scripts, schedules
  events, builds DSP chains, renders spatial audio, exports offline. The boundary is
  load-bearing: nothing in `engine/` may import React.
- **`ui/`** — the React app (pages, components, hooks). Talks to the engine through one
  hook, `useSatieEngine`, which exposes a throttled UI snapshot **and** a direct
  `tracksRef` that Three.js reads in its render loop (no React state between engine and
  viewport — that rule is performance-critical).
- **`lib/`** — shared, framework-light services: AI generation, Supabase data/auth,
  community samples, caching, code-splitting.
- **`api/`** — Vercel Functions: the AI proxy, audio generation, and Stripe billing.

### Audio signal chain

```
Source → Gain → Filter → Distortion → Delay → Reverb → EQ → Panner(HRTF) → Master → Limiter → Out
```

---

## Map of the wiki

### engine/ — the audio runtime
- [`_index.md`](./engine/_index.md) — subsystem overview & boundaries
- [`parser.md`](./engine/parser.md) — `SatieParser`: script text → `Statement[]`
- [`engine.md`](./engine/engine.md) — `SatieEngine`: runtime, track lifecycle, scheduling
- [`scheduler.md`](./engine/scheduler.md) — `SatieScheduler` + `SatieDSPClock`
- [`statement-model.md`](./engine/statement-model.md) — `Statement`, `RangeOrValue`, `InterpolationData`, `EaseFunctions`
- [`dsp.md`](./engine/dsp.md) — `DSPChain`: native Web Audio effect chains
- [`spatial.md`](./engine/spatial.md) — trajectories + AI trajectory generation
- [`export.md`](./engine/export.md) — offline render: stereo, binaural, ambisonic FOA
- [`audio-gen.md`](./engine/audio-gen.md) — ElevenLabs generation + IndexedDB cache

### dsl/ — the Satie language spec
- [`_index.md`](./dsl/_index.md) — the language, mental model
- [`grammar.md`](./dsl/grammar.md) — syntax, parsing order, groups, gen blocks
- [`properties.md`](./dsl/properties.md) — every property, value/range/interpolation
- [`spatial-movement.md`](./dsl/spatial-movement.md) — trajectories from the author's POV
- [`dsp-effects.md`](./dsl/dsp-effects.md) — reverb/delay/filter/distortion/EQ params
- [`metadata-comments.md`](./dsl/metadata-comments.md) — `# @bg` and friends

### lib/ — shared services
- [`_index.md`](./lib/_index.md) · [`ai-pipeline.md`](./lib/ai-pipeline.md) · [`ai-providers.md`](./lib/ai-providers.md) · [`database.md`](./lib/database.md) · [`auth.md`](./lib/auth.md) · [`community.md`](./lib/community.md) · [`storage-cache.md`](./lib/storage-cache.md) · [`performance.md`](./lib/performance.md) · [`audio-analysis.md`](./lib/audio-analysis.md)

### ui/ — the React app
- [`_index.md`](./ui/_index.md) · [`pages.md`](./ui/pages.md) · [`editor-workspace.md`](./ui/editor-workspace.md) · [`viewport.md`](./ui/viewport.md) · [`chat.md`](./ui/chat.md) · [`ai-panel.md`](./ui/ai-panel.md) · [`community-ui.md`](./ui/community-ui.md) · [`panels-assets.md`](./ui/panels-assets.md) · [`layout-nav.md`](./ui/layout-nav.md) · [`hooks.md`](./ui/hooks.md) · [`theme.md`](./ui/theme.md) · [`primitives.md`](./ui/primitives.md)

### api/ & data/
- [`api/_index.md`](./api/_index.md) · [`api/endpoints.md`](./api/endpoints.md) · [`api/payments.md`](./api/payments.md)
- [`data/schema.md`](./data/schema.md) — Supabase schema & migrations

---

## Conventions recap

- Satie DSL properties are `key value` (space-separated, no `=`). snake_case in the
  language, camelCase in TypeScript.
- UI uses inline styles and theme tokens (`useTheme()`), never hardcoded hex.
- No emojis in code or UI; SVG icons instead.
- See [`_conventions.md`](./_conventions.md) for the wiki's own rules and the freshness gate.
