---
title: Hooks — engine bridge & friends
subsystem: ui
sources:
  - src/ui/hooks/useSatieEngine.ts
  - src/ui/hooks/useBackgroundMusic.ts
  - src/ui/hooks/useFaceTracking.ts
  - src/ui/hooks/useHeadTracking.ts
  - src/ui/hooks/useSamplePreview.ts
  - src/ui/hooks/useDayNightCycle.ts
  - src/ui/hooks/useSFX.ts
synced_sha: 0e84d4ec4efa
synced: 2026-05-31
related: [../engine/engine.md, viewport.md]
---

# Hooks — engine bridge & friends

## Purpose

The custom React hooks that wire UI pages to the audio engine, ambient background music, head/face listener control, sample previewing, theming, and UI sound effects.

## Why it exists / responsibilities

React components must not own the engine's hot data (track positions, currentTime) as state — re-rendering at audio rates would destroy frame budget. These hooks own the bridge: they expose a *throttled* React-visible snapshot for chrome (time display, errors, track count) and a *direct ref* to live engine data for Three.js to read in its own render loop. The remaining hooks are small, mostly singleton-backed helpers for cross-cutting browser concerns (AudioContext lifecycle, DeviceOrientation, getUserMedia, theme drift) that need a hook shape so any page can opt in.

## Mental model

```
                      useSatieEngine
   page chrome ◄── uiState (8fps, React state) ──┐
                                                  │  SatieEngine
   <SpatialViewport> ── tracksRef (live ref) ◄────┘  (engine/engine.md)
       reads in useFrame, NO React re-render

   useBackgroundMusic ── module singleton (AudioContext, audioData)
       ↕ playingTokens  ◄── useSatieEngine registers per-instance token
       so BG music is silenced while ANY engine plays scene audio
```

Each hook except `useSatieEngine`/`useFaceTracking`/`useHeadTracking` is backed by **module-level singleton state** (one shared AudioContext / one music player), so playback survives route changes and only one instance is live at a time.

## Key types & functions

### useSatieEngine — the engine bridge

`useSatieEngine()` at src/ui/hooks/useSatieEngine.ts:13. Constructs one `SatieEngine` per mount and returns:

- `engine` — the `engineRef` (ref to the `SatieEngine` instance) — src/ui/hooks/useSatieEngine.ts:139.
- `uiState` — `EngineUIState` snapshot updated only via `engine.subscribeUI` (throttled to ~8fps by the engine). Carries `isPlaying`, `currentTime`, `trackCount`, `statements`, `errors`, `runtimeWarnings`, `mutedIndices`, `soloedIndices` — src/ui/hooks/useSatieEngine.ts:30.
- `tracksRef` — ref to the engine's live tracks array (`TrackState[]`), refreshed inside the UI subscription and after `loadScript`/`stop`. Read directly by Three.js in `useFrame` — never causes a React re-render — src/ui/hooks/useSatieEngine.ts:15.
- Action callbacks: `loadScript`, `play`, `stop`, `loadAudioFile`, `loadAudioBuffer`, `setMasterVolume`, `toggleMute`, `toggleSolo`, `setListenerPosition`, `setListenerOrientation`, `setOnMissingBuffer`, `setOnSearchCommunity`, `setPreferCommunity` — src/ui/hooks/useSatieEngine.ts:73-136.

Volume is split: `userMasterVolRef` holds the user's slider value; `applyMasterVolume()` pushes `muted ? 0 : userMasterVol` so the global header mute can dim engine output without clobbering the dialed-in level — src/ui/hooks/useSatieEngine.ts:19,24. The engine subscribes to the global mute via `subscribeMusicEnabled` — src/ui/hooks/useSatieEngine.ts:55.

`enginePlayingTokenRef` is a stable per-instance `symbol`; an effect mirrors `uiState.isPlaying` into the BG-music subsystem via `setEnginePlaying(token, playing)` so background music pauses while the scene plays — src/ui/hooks/useSatieEngine.ts:22,69.

### useBackgroundMusic — deferred singleton ambient player

`useBackgroundMusic(src, volume = 0.08)` at src/ui/hooks/useBackgroundMusic.ts:211. All playback state (`ctx`, `source`, `gain`, `audioData`, `activeCount`, `musicEnabled`) lives at module scope. Key behaviors:

- **Deferred fetch.** The asset (the ~33MB Satie theme) is NOT downloaded on mount; the hook installs `click`/`keydown`/`pointerdown` listeners and only `fetch`es on the first user gesture, since AudioContext needs a gesture anyway — src/ui/hooks/useBackgroundMusic.ts:221. `audioData` is cached at module scope and reused across pages — fetched once per session.
- **Reference counting.** `activeCount` tracks mounted pages using the hook; on unmount a 200ms-delayed check calls `stopMusic()` only when the count hits zero, so route transitions between two music-bearing pages don't cause a gap — src/ui/hooks/useBackgroundMusic.ts:251.
- **Engine gating.** `setEnginePlaying(token, playing)` at src/ui/hooks/useBackgroundMusic.ts:134 maintains a `playingTokens` set; `tryStart` refuses to start while `isAnyEnginePlaying()` is true, and music only resumes when the *last* token is removed (and the user hasn't muted, a page is still mounted, and `softStopped` is false). Idempotent so noisy throttled `isPlaying` flips don't restart playback — src/ui/hooks/useBackgroundMusic.ts:38,148.
- **Exports.** `stopBackgroundMusic()` (soft stop, e.g. during generation) — :102; `getMusicEnabled()` — :108; `subscribeMusicEnabled(fn)` — :116; `setMusicEnabled(enabled)` (session-only, not persisted) — :162; `useMusicEnabled()` hook returning `[enabled, toggle]` — :182.
- `tryStart` ramps gain 0→`volume` over 5s; `stopPlayback` ramps to 0 over 0.8s then closes the context after 900ms — src/ui/hooks/useBackgroundMusic.ts:58,77.

### useFaceTracking — webcam listener control

`useFaceTracking(onOrientationChange?)` at src/ui/hooks/useFaceTracking.ts:59. Uses MediaPipe `FaceLandmarker` (lazy module-singleton `_landmarkerPromise`, GPU delegate, VIDEO mode) — :12. `start()` opens a hidden 320×240 `<video>` via getUserMedia and runs a ~24fps rAF loop calling `detectForVideo` — :77. `estimateYawPitch` derives angles from nose tip (1) and ear tragions (234/454); webcam is mirrored — :31. Yaw/pitch are exponentially smoothed (`syaw`/`spitch`, factor 0.1), converted to forward/up vectors, and pushed via `cbRef.current(...)` — :113. Returns `{ enabled, loading, error, toggle, meshRef }`; `meshRef` is a live `FaceMeshData` (478 landmarks as flat Float32Array + yaw/pitch) read by Three.js in `useFrame` — :66,50. A failed `start()` nulls `_landmarkerPromise` to allow retry — :143.

### useHeadTracking — device orientation listener control

`useHeadTracking(onOrientationChange?)` at src/ui/hooks/useHeadTracking.ts:13. Returns `{ enabled, available, toggle }`. `available` reflects `'DeviceOrientationEvent' in window`. When enabled, it requests iOS 13+ permission if `requestPermission` exists, then listens for `deviceorientation`, converting alpha/beta/gamma (deg→rad) into forward and up vectors passed to the callback — src/ui/hooks/useHeadTracking.ts:29-47.

### useSamplePreview — inline single-sample player

`useSamplePreview()` at src/ui/hooks/useSamplePreview.ts:15. One shared module-level preview `AudioContext` (`getPreviewCtx`, resumes if suspended) — :8. Only one preview plays at a time. Returns `{ play, stop, isPlaying, playingId, progress }`. `play(id, data, seekTo?)` decodes (caches the decoded `AudioBuffer` per id), supports seeking via `seekTo` (0–1 fraction of duration), toggles off if the same id is already playing with no seek, and drives a rAF `updateProgress` loop reporting `progress` 0–1 — :56,37. Cleans up the source on unmount — :108.

### useDayNightCycle — theme drift

`useDayNightCycle()` at src/ui/hooks/useDayNightCycle.ts:109. Returns `{ theme, mode, setMode }` where `mode` is `'light' | 'dark' | 'fade'`, persisted to `localStorage['satie-theme-mode']` (default `'dark'`) — :101,103. Static modes set `LIGHT`/`DARK` from `../theme/tokens`. `'fade'` runs a rAF loop throttled to 200ms (~5fps) that cycles `PASTELS` (10s per palette) via `buildFadeTheme` (cosine-interpolated bg gradient over a `...LIGHT` spread) and plays a subtle sine `playPaletteChime` on each palette transition — :30,64,134. `Theme`/`ThemeMode` are re-exported from this module for back-compat — :6.

### useSFX — UI sound effects

`useSFX()` at src/ui/hooks/useSFX.ts:88. Returns `{ hover, click, play, stop, save, toggle, open, close, del, splash, enabled }`. Backed by a shared module `AudioContext` (`getCtx`) — :5. Sounds are short filtered noise bursts: `thud` (lowpass), `tap` (bandpass), `microTap` (highpass) — :14,39,64. `hover` uses a 120ms cooldown to avoid rapid-fire; `open`/`close`/`splash` are intentional no-ops. `enabled` is a ref gate (default true) checked by every emitter — :89,116,135.

## Data flow

- **In:** `useSatieEngine` is consumed by [editor-workspace](./editor-workspace.md), [chat](./chat.md), and public-view pages ([pages](./pages.md)); its `tracksRef`/`meshRef` are read by [viewport](./viewport.md) inside `useFrame`. `useHeadTracking`/`useFaceTracking` callbacks feed `setListenerOrientation` on the engine.
- **Out:** `useSatieEngine` constructs and drives `SatieEngine` (see [engine](../engine/engine.md)) and registers a playing-token with the `useBackgroundMusic` singleton. `useBackgroundMusic` and `useSatieEngine` cross-talk only through the exported `getMusicEnabled` / `subscribeMusicEnabled` / `setEnginePlaying` functions — there is no React state shared between them.

## Invariants & gotchas

- **Never put React state between the engine and the 3D viewport.** `tracksRef`/`meshRef` are refs read in `useFrame`; routing live data through `useState` would re-render at audio/camera rates. (UI rules, `.claude/rules/ui.md`.)
- **`uiState` is ~8fps and throttled by the engine**, not the hook. Use it only for chrome (time, counts, errors), never for per-frame positioning.
- **Master volume vs. mute are orthogonal.** The engine is always set to `userMasterVol * (muted ? 0 : 1)`; never write 0 directly to `userMasterVolRef` to mute, or unmuting will restore silence.
- **`setEnginePlaying` must be called with the same per-instance token for both true and false**, or the `playingTokens` set leaks and background music never resumes. It is idempotent by design to absorb noisy throttled `isPlaying` flips.
- **Background music is session-only.** `musicEnabled` is never persisted — each fresh session starts ON regardless of last visit's toggle. Fetch is deferred to the first gesture; do not eagerly download the asset on mount (bandwidth, see the module comment).
- **Singleton AudioContexts** (`useSamplePreview`, `useSFX`, `useBackgroundMusic`, `playPaletteChime`) all need a prior user gesture to leave `suspended` — every audio-touching hook assumes the gesture constraint (`.claude/rules/ui.md`).
- **Theme gotcha:** components must read these `theme` tokens, not hardcode hex, or dark/fade modes break — see `docs/lessons.md` entry 8 (Theming / dark mode).

## Change checklist

- Adding an engine action: add a `useCallback` in `useSatieEngine` and to the returned object; keep `tracksRef` refreshed after any mutation that changes tracks (`loadScript`/`stop` pattern).
- New `EngineUIState` field: extend the type in `src/engine` and the initial state object at src/ui/hooks/useSatieEngine.ts:30.
- Changing BG-music gating: keep `setEnginePlaying` idempotent and token-symmetric; verify `tryStart` still checks `isAnyEnginePlaying()`.
- New theme token consumed by hooks: add it to `../theme/tokens` (`LIGHT`/`DARK`/`PASTELS`) so `buildFadeTheme`'s `...LIGHT` spread inherits it.
- New UI sound: add a generator and a gated `useCallback`; respect the `enabled` ref and add a cooldown for high-frequency events (cf. `hover`).

## Sources

- src/ui/hooks/useSatieEngine.ts
- src/ui/hooks/useBackgroundMusic.ts
- src/ui/hooks/useFaceTracking.ts
- src/ui/hooks/useHeadTracking.ts
- src/ui/hooks/useSamplePreview.ts
- src/ui/hooks/useDayNightCycle.ts
- src/ui/hooks/useSFX.ts
