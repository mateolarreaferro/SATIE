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
│   ├── export/
│   │   ├── OfflineRenderer.ts  # Offline render: stereo, binaural, ambisonic FOA
│   │   ├── AmbisonicEncoder.ts # FOA encoding (AmbiX ACN/SN3D)
│   │   └── WAVEncoder.ts       # AudioBuffer → WAV blob (16/24-bit)
│   └── spatial/
│       ├── Trajectories.ts  # Builtin (spiral/orbit/lorenz) + custom LUT trajectories
│       └── TrajectoryGen.ts # AI trajectory code generation (provider-agnostic)
├── lib/                     # Shared utilities & external service clients
│   ├── supabase.ts          # Supabase client init
│   ├── AuthContext.tsx       # OAuth provider (GitHub/Google)
│   ├── aiProvider.ts        # Unified AI provider abstraction (Claude/OpenAI/Gemini)
│   ├── sketches.ts          # Sketch CRUD
│   ├── sampleCache.ts       # Client-side audio sample cache (IndexedDB)
│   ├── sampleStorage.ts     # Supabase Storage for samples
│   ├── trajectoryCache.ts   # IndexedDB for custom trajectories
│   ├── feedbackStore.ts     # RLHF feedback storage for AI generations
│   └── userSettings.ts      # API key storage (localStorage + Supabase)
├── ui/
│   ├── pages/
│   │   ├── Dashboard.tsx    # Landing page, sketch management, settings
│   │   ├── Editor.tsx       # Main workspace (editor + viewport + panels)
│   │   ├── SketchView.tsx   # Public sketch view (/s/:id) with play/like/fork
│   │   ├── Gallery.tsx      # Public sketch gallery (/explore)
│   │   ├── UserProfile.tsx  # User profile page (/u/:username)
│   │   └── Embed.tsx        # Embeddable sketch player (/embed/:id)
│   ├── components/
│   │   ├── SatieEditor.tsx  # Monaco editor: syntax highlighting, autocomplete, hover docs, live validation
│   │   ├── SpatialViewport.tsx # Three.js R3F 3D visualization with axis gizmo
│   │   ├── DocsPanel.tsx    # In-app language reference (10 sections)
│   │   ├── AssetPanel.tsx   # Samples + Trajectories tabs
│   │   ├── AIPanel.tsx      # AI generation UI (multi-provider)
│   │   ├── RecordWidget.tsx # Mic recording with waveform trim
│   │   ├── Sidebar.tsx      # Sidebar with transport, panel toggles, save/share
│   │   ├── Panel.tsx        # Draggable/resizable panel wrapper (persists layout)
│   │   ├── ExportPanel.tsx  # Offline export (stereo/binaural/ambisonic)
│   │   ├── VoicesPanel      # Per-voice mute/solo mixer (inline in Editor.tsx)
│   │   └── VersionsPanel.tsx # Script version history
│   ├── hooks/
│   │   ├── useSatieEngine.ts # Engine hook: throttled UI state + direct track refs
│   │   ├── useSFX.ts        # UI sound effects (noise taps with cooldown)
│   │   └── useHeadTracking.ts # Device orientation for listener rotation
│   └── styles/
│       └── interactions.css
└── main.tsx                 # Entry: BrowserRouter → AuthProvider → Routes
```

## Architecture

### Engine ↔ UI Boundary

The engine (`src/engine/`) is a standalone Web Audio runtime with zero React dependencies. The UI connects to it through `useSatieEngine` hook which provides:

- `engine` — ref to the `SatieEngine` instance
- `uiState` — throttled snapshot updated at 8fps for React rendering
- `tracksRef` — direct ref to the engine's live tracks array (read by Three.js in `useFrame`, no React re-renders)

**Key performance rule:** Three.js reads `tracksRef` directly in its render loop. Never add React state between the engine and the 3D viewport.

### Audio Signal Chain

Source → Gain → Filter → Distortion → Delay → Reverb → EQ → Panner → Master Gain → Limiter → Destination

- All effects use native Web Audio nodes with dry/wet crossfaders via GainNodes
- Master limiter (`DynamicsCompressorNode`) prevents clipping when many voices overlap
- Panner uses HRTF model for spatial audio

### Scheduler

`SatieScheduler` uses a sorted array with O(1) front-consume and O(log n) binary-search insert. Events are scheduled ahead of `AudioContext.currentTime`.

### Spatial Audio

- Voices use `HRTF` panning for accurate spatial perception
- Position updates rate-limited to 30fps
- Trajectories: analytical (spiral/orbit) or pre-computed LUTs (lorenz, custom)
- Custom trajectories stored as interleaved xyz Float32Array (8192 points)
- FOA ambisonic export with AmbiX convention (ACN/SN3D)

### AI Provider System

`src/lib/aiProvider.ts` provides a unified abstraction for AI calls:

- **Anthropic** (Claude Sonnet / Haiku) — primary provider
- **OpenAI** (GPT-4o / GPT-4o-mini) — alternative
- **Google Gemini** (Flash / Flash Lite) — alternative
- `createProvider()` selects preferred provider, falls back to any configured one
- `createFastProvider()` returns cheaper model variant for repair/verification
- Provider preference stored in `localStorage` (`satie-ai-provider`)

### Sketch Sharing & Public View

- Sketches can be toggled public/private via sidebar
- Public sketches viewable at `/s/:id` with play/like/fork
- Gallery at `/explore` lists all public sketches
- Embeddable player at `/embed/:id`
- On save, **all engine audio buffers** (including AI-generated audio) are converted to WAV and uploaded to Supabase Storage so public viewers can play without API keys
- Viewport background color is embedded as `# @bg #hexcolor` comment in the script for persistence across sharing

### Workspace Zoom

The editor workspace (where panels live) supports CSS transform-based zoom (25%–200%) via controls in the bottom-right corner.

## Parser

`SatieParser.ts` is the largest file (~1600 lines). It uses regex patterns to parse `.satie` scripts into `Statement[]`.

**Parsing order:**
1. Strip block comments (`comment`/`endcomment`)
2. Handle `let` variable declarations
3. Expand multi-clip syntax
4. Extract trajectory gen blocks
5. Extract audio gen blocks
6. Process groups (`group`/`endgroup`) with property inheritance
7. Parse individual statements + their indented property blocks

**When adding new properties:** add the case to the `switch` in `parseSingle()` and add the field to `Statement.ts`.

### Script Metadata Comments

The parser ignores `#` comments, but certain `# @` prefixed comments carry metadata:
- `# @bg #hexcolor` — viewport background color (persisted on save, restored on load/share)

## Editor Intelligence

`SatieEditor.tsx` provides Monaco editor integration with:

- **Monarch tokenizer** for syntax highlighting (keywords, properties, DSP, easing, colors, ranges)
- **Completion provider** — context-aware suggestions for keywords, properties, movement types, filter/distortion modes, easing curves
- **Hover provider** — documentation tooltips for all properties and keywords
- **Live validation** — debounced (400ms) re-parse on keystroke, errors shown as red squiggly underlines via Monaco markers

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
| Anthropic (Claude) | Script/trajectory/sample gen, code repair | localStorage (`satie-anthropic-key`) |
| OpenAI | Script/trajectory/sample gen (alternative) | localStorage (`satie-openai-key`) |
| Google Gemini | Script/trajectory/sample gen (alternative) | localStorage (`satie-gemini-key`) |

API keys are entered by users in the Dashboard settings panel. They are never hardcoded or committed. The AI provider preference is stored in `localStorage` (`satie-ai-provider`).

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
/explore       → Gallery (public sketches)
/s/:id         → SketchView (public sketch with play/like/fork)
/embed/:id     → Embed (iframe-friendly player)
/u/:username   → UserProfile (user's public sketches)
```

## Conventions

- No linter or formatter configured — follow existing code style
- Use inline styles (no CSS modules or styled-components)
- Color palette: background #f4f3ee, text #0a0a0a, accent #1a3a2a, danger #8b0000
- Properties in Satie syntax are `key value` (space-separated, no equals signs)
- Property names use snake_case in the language (e.g. `fade_in`) but camelCase in TypeScript
- All DSP parameters support both static values, ranges, and interpolation
- Gen blocks define generation parameters separately from playback statements
- Standalone flags (overlap, persistent, mute, solo, randomstart, loopable) take no value
- `background` / `bg` property sets viewport bg color (accepts hex, RGB, grayscale, named colors)

## Common Tasks

### Adding a new Satie property

1. Add the field to `Statement` class in `Statement.ts`
2. Add the `case` to the `switch` in `parseSingle()` in `SatieParser.ts`
3. Handle the property in `SatieEngine.ts` (track creation or per-frame update)
4. Add parser tests in `SatieParser.test.ts`
5. Add to syntax highlighting in `SatieEditor.tsx` (tokenizer + PROPERTY_DOCS + completion)
6. Add to `DocsPanel.tsx` properties table

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
5. Add wander scheduling in `OfflineRenderer.ts` for export support

### Adding a new UI panel

1. Create the component in `src/ui/components/`
2. Add the key to `PanelVisibility` interface in `Sidebar.tsx`
3. Add the icon to the sidebar panel toggles array
4. Initialize the key in `panels` state in `Editor.tsx`
5. Render it in `Editor.tsx` with the `Panel` wrapper component

### Adding a new AI provider

1. Add the provider class in `src/lib/aiProvider.ts` implementing `AIProvider` interface
2. Add it to the `order` array in `createProvider()`
3. Add the key field to `UserSettings` in `userSettings.ts` (+ localStorage constant + Supabase select/save)
4. Add the key input to Dashboard settings
5. Add the option to the provider `<select>` in `AIPanel.tsx`
