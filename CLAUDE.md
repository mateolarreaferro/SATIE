# CLAUDE.md — Satie Development Guide

## What is Satie?

Satie is a domain-specific language for spatial audio composition in the browser. Users write plaintext scripts that spawn sound voices positioned in 3D space with DSP effects, interpolation, and visual feedback.

## Quick Reference

```bash
npm run dev          # Start dev server
npm run build        # TypeScript check + production build
npm run test         # Run all tests once
npm run test:watch   # Tests in watch mode
```

## Project Structure

```
src/
├── engine/                  # Pure audio engine (no React)
│   ├── index.ts             # Public API exports
│   ├── core/
│   │   ├── SatieParser.ts   # Regex parser: script text → Statement[]
│   │   ├── SatieEngine.ts   # Web Audio runtime, track lifecycle, scheduling
│   │   ├── SatieScheduler.ts # Sorted-array scheduler (O(log n) insert)
│   │   ├── SatieDSPClock.ts # AudioContext.currentTime clock
│   │   ├── Statement.ts     # Parsed statement data class
│   │   ├── RangeOrValue.ts  # Single value or min/max range with sampling
│   │   ├── InterpolationData.ts # goto/gobetween/interpolate config
│   │   ├── EaseFunctions.ts # Easing curves (quad, cubic, expo, elastic, etc.)
│   │   └── __tests__/       # Unit tests for all core modules
│   ├── dsp/
│   │   ├── DSPChain.ts      # Native Web Audio node chains (filter, reverb, delay, distortion, EQ)
│   │   └── __tests__/
│   ├── audio/
│   │   └── AudioGen.ts      # ElevenLabs sound generation + IndexedDB cache
│   └── spatial/
│       ├── Trajectories.ts  # Builtin (spiral/orbit/lorenz) + custom LUT trajectories
│       └── TrajectoryGen.ts # Claude API trajectory code generation
├── lib/                     # Shared utilities & external service clients
│   ├── supabase.ts          # Supabase client init
│   ├── AuthContext.tsx       # OAuth provider (GitHub/Google)
│   ├── sketches.ts          # Sketch CRUD
│   ├── sampleCache.ts       # Client-side audio sample cache
│   ├── sampleStorage.ts     # Supabase Storage for samples
│   ├── trajectoryCache.ts   # IndexedDB for custom trajectories
│   └── userSettings.ts      # API key storage (localStorage + Supabase)
├── ui/
│   ├── pages/
│   │   ├── Dashboard.tsx    # Landing page, sketch management, settings
│   │   └── Editor.tsx       # Main workspace (editor + viewport + panels)
│   ├── components/
│   │   ├── SatieEditor.tsx  # Monaco editor with Satie syntax highlighting
│   │   ├── SpatialViewport.tsx # Three.js R3F 3D visualization
│   │   ├── TransportControls.tsx # Play/stop/time
│   │   ├── AssetPanel.tsx   # Samples + Trajectories tabs
│   │   ├── AIPanel.tsx      # AI generation UI
│   │   ├── RecordWidget.tsx # Mic recording with waveform trim
│   │   └── ...
│   ├── hooks/
│   │   ├── useSatieEngine.ts # Engine hook: throttled UI state + direct track refs
│   │   └── useSFX.ts
│   └── styles/
│       └── interactions.css
└── main.tsx                 # Entry: BrowserRouter → AuthProvider → Routes
```

## Architecture

### Engine ↔ UI Boundary

The engine (`src/engine/`) is a standalone Web Audio runtime with zero React dependencies. The UI connects to it through `useSatieEngine` hook which provides:

- `engine` — the `SatieEngine` instance
- `uiState` — throttled snapshot updated at 8fps for React rendering
- `tracksRef` — direct ref to the engine's live tracks array (read by Three.js in `useFrame`, no React re-renders)

**Key performance rule:** Three.js reads `tracksRef` directly in its render loop. Never add React state between the engine and the 3D viewport.

### DSP Chain Order

Source → Filter → Distortion → Delay → Reverb → EQ → Output

All effects use native Web Audio nodes. Each has a dry/wet crossfader via GainNodes.

### Scheduler

`SatieScheduler` uses a sorted array with O(1) front-consume and O(log n) binary-search insert. Events are scheduled ahead of `AudioContext.currentTime`.

### Spatial Audio

- Voices use `equalpower` panning (not HRTF) for CPU efficiency
- Position updates rate-limited to 30fps
- Trajectories: analytical (spiral/orbit) or pre-computed LUTs (lorenz, custom)
- Custom trajectories stored as interleaved xyz Float32Array (8192 points)

## Parser

`SatieParser.ts` is the largest file (~1500 lines). It uses regex patterns to parse `.satie` scripts into `Statement[]`.

**Parsing order:**
1. Strip block comments (`comment`/`endcomment`)
2. Handle `let` variable declarations
3. Expand multi-clip syntax
4. Extract trajectory gen blocks
5. Extract audio gen blocks
6. Process groups (`group`/`endgroup`) with property inheritance
7. Parse individual statements + their indented property blocks

**When adding new properties:** add the case to the `switch` in `parseSingle()` and add the field to `Statement.ts`.

## Testing

Tests live next to the code in `__tests__/` directories. All engine modules have unit tests.

```bash
npm run test         # vitest run
npm run test:watch   # vitest (watch mode)
```

Tests use Vitest. No mocks for Web Audio — tests that need AudioContext stub it minimally.

## External Services

| Service | What it does | Keys stored in |
|---------|-------------|----------------|
| Supabase | Auth, sketch DB, sample storage | `.env` (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY) |
| ElevenLabs | Audio generation | localStorage (`satie-elevenlabs-key`) |
| Anthropic (Claude) | Trajectory generation, AI panel | localStorage (`satie-anthropic-key`) |
| OpenAI | AI panel (alternative) | localStorage (`satie-openai-key`) |

API keys are entered by users in the Dashboard settings panel. They are never hardcoded or committed.

## Path Aliases

Defined in both `tsconfig.json` and `vite.config.ts`:

- `@engine/*` → `src/engine/*`
- `@ui/*` → `src/ui/*`
- `@api/*` → `src/api/*`

## Routing

```
/              → Dashboard (sketch list, auth, settings)
/editor        → Editor (new sketch)
/editor/:id    → Editor (load sketch by ID)
```

## Conventions

- No linter or formatter configured — follow existing code style
- Properties in Satie syntax are `key value` (space-separated, no equals signs)
- Property names use snake_case in the language (e.g. `fade_in`) but camelCase in TypeScript
- All DSP parameters support both static values, ranges, and interpolation
- Gen blocks define generation parameters separately from playback statements
- Standalone flags (overlap, persistent, mute, solo, randomstart, loopable) take no value

## Common Tasks

### Adding a new Satie property

1. Add the field to `Statement` class in `Statement.ts`
2. Add the `case` to the `switch` in `parseSingle()` in `SatieParser.ts`
3. Handle the property in `SatieEngine.ts` (track creation or per-frame update)
4. Add parser tests in `SatieParser.test.ts`

### Adding a new DSP effect

1. Create the Web Audio node chain in `DSPChain.ts`
2. Add the params interface to `Statement.ts`
3. Add the parser function in `SatieParser.ts` (follow `parseReverb` as a template)
4. Wire it into the chain order in `DSPChain.buildChain()`

### Adding a new trajectory type

1. Add the enum value to `WanderType` in `Statement.ts`
2. Add the evaluation function in `Trajectories.ts`
3. Add the parser case in `parseMove()` in `SatieParser.ts`
4. The engine already handles trajectory evaluation generically via `Trajectories.evaluate()`

### Adding a new UI panel

1. Create the component in `src/ui/components/`
2. Add the panel toggle to `Sidebar.tsx`
3. Render it in `Editor.tsx` with the `Panel` wrapper component
