---
title: Panels & assets — docs, export, versions, record, trajectories, transport
subsystem: ui
sources:
  - src/ui/components/AssetPanel.tsx
  - src/ui/components/DocsPanel.tsx
  - src/ui/components/ExportPanel.tsx
  - src/ui/components/VersionsPanel.tsx
  - src/ui/components/RecordWidget.tsx
  - src/ui/components/TrajectoriesTab.tsx
  - src/ui/components/TrajectoryPreview.tsx
  - src/ui/components/AudioLoader.tsx
  - src/ui/components/TransportControls.tsx
  - src/ui/components/ControlsHint.tsx
synced_sha: 073fac477bc6
synced: 2026-06-03
related: [editor-workspace.md, ../engine/export.md]
---

## Purpose

The editor's side-panels and small asset widgets: browsing/loading samples and trajectories, the in-app language reference, offline/video export, version history, mic recording with waveform trim, and the transport/controls chrome.

## Why it exists / responsibilities

These are the leaf UI components mounted inside the [editor workspace](./editor-workspace.md) `Panel` wrappers (or, for transport/hint, as fixed chrome). Each owns one concern and is dumb about the engine — they receive callbacks and refs from `Editor.tsx` and call back out. None of them holds engine state; they read snapshots (`samples`, `currentTime`, `isPlaying`) or talk to engine/lib helpers directly.

Note: these are presentational components. Three.js still reads `tracksRef` directly in `useFrame` — none of these panels sits between the engine and the 3D viewport.

## Mental model

```
AssetPanel ── tabs ──► SamplesTab | TrajectoriesTab | CommunityTab
                                        └─ TrajectoryPreview (canvas mini-render)
DocsPanel        — static SECTIONS[] + tiny markdown renderer
ExportPanel      — renderOffline() → preview AudioBuffer → encodeWAV → download
VersionsPanel    — getVersions(sketchId) → list → onRestore()
RecordWidget     — getUserMedia → MediaRecorder → decode → trim → WAV → onSave()
AudioLoader      — file picker / drag-drop → onLoadBuffer()
TransportControls— play/stop/time/voice-count/master-volume chrome
ControlsHint     — informational glass pill (pointer-events: none)
```

## Key types & functions

### AssetPanel
- `AssetTab = 'samples' | 'trajectories' | 'community'` — local `tab` state, three toggle buttons ([AssetPanel.tsx:8](../../../src/ui/components/AssetPanel.tsx)).
- `AssetPanel(props)` ([AssetPanel.tsx:19](../../../src/ui/components/AssetPanel.tsx)) — renders the active tab. Props pass straight through: `samples`, `onLoadBuffer`, `onDeleteSample`, `onPreviewSample` go to `SamplesTab`/`CommunityTab`; `onGenerateTrajectory` + `generatingTrajectory` go to `TrajectoriesTab`.
- Sample count badge shown only on the samples tab ([AssetPanel.tsx:76](../../../src/ui/components/AssetPanel.tsx)).

### DocsPanel
- `SECTIONS: Section[]` ([DocsPanel.tsx:11](../../../src/ui/components/DocsPanel.tsx)) — 10 hardcoded reference sections (Quick Start, Statements, Properties, Ranges, Modulation, Movement, DSP Effects, Groups, Variables, Comments). Each `{ title, id, content }` where `content` is a markdown string. The Movement section leads with the semantic `place` (sector/depth/height/extent) and `move` archetype vocabulary and the source-archetype guidance, with low-level `walk`/`fly`/trajectory forms below (mirrors [spatial-movement](../dsl/spatial-movement.md)).
- `DocsPanel` ([DocsPanel.tsx:317](../../../src/ui/components/DocsPanel.tsx)) — `memo`'d; wrap-flow nav buttons + active section. No external data.
- `MarkdownRenderer` ([DocsPanel.tsx:348](../../../src/ui/components/DocsPanel.tsx)), `InlineMarkdown` ([DocsPanel.tsx:434](../../../src/ui/components/DocsPanel.tsx)), `SimpleTable` ([DocsPanel.tsx:463](../../../src/ui/components/DocsPanel.tsx)) — a minimal hand-rolled markdown renderer supporting `#` headings, fenced code blocks, `|` tables, `**bold**`, and inline `` `code` ``.

### ExportPanel
- `ExportFormat = 'stereo' | 'binaural' | 'ambisonic-foa' | 'video'` ([ExportPanel.tsx:14](../../../src/ui/components/ExportPanel.tsx)).
- `handleExportAudio` ([ExportPanel.tsx:53](../../../src/ui/components/ExportPanel.tsx)) — calls `renderOffline({ script, sampleBuffers, decodedAudioBuffers, duration, sampleRate, mode })` from [engine/export](../engine/export.md). Stores the resulting `AudioBuffer` in `previewBuffer` instead of auto-downloading.
- `handleDownload` ([ExportPanel.tsx:110](../../../src/ui/components/ExportPanel.tsx)) — `encodeWAV(previewBuffer, bitDepth)` then `downloadBlob`; filename suffix per format (`stereo` / `binaural-HRTF` / `FOA-AmbiX`).
- `handlePreview` ([ExportPanel.tsx:122](../../../src/ui/components/ExportPanel.tsx)) — plays the rendered buffer through a private `AudioContext`; for >2-channel (ambisonic) it copies channel 0 (W) to a mono buffer for preview.
- `handleStartVideoRecord` / `handleStopVideoRecord` ([ExportPanel.tsx:155](../../../src/ui/components/ExportPanel.tsx)) — `canvas.captureStream(30)` + optional audio from `window.__satieAudioCtx`, records `video/webm;codecs=vp9` via `MediaRecorder`, downloads `satie-capture.webm`.
- `cancelledRef` ([ExportPanel.tsx:36](../../../src/ui/components/ExportPanel.tsx)) — checked inside the `renderOffline` progress callback to abort.

### VersionsPanel
- `VersionsPanel({ sketchId, onRestore })` ([VersionsPanel.tsx:13](../../../src/ui/components/VersionsPanel.tsx)) — loads `getVersions(sketchId)` from `lib/versions`, renders an expandable list of `SketchVersion`.
- `handleRestore` ([VersionsPanel.tsx:28](../../../src/ui/components/VersionsPanel.tsx)) — `confirm()` then `onRestore(v.script, v.title)`.
- Empty/no-id states: prompts to save first ([VersionsPanel.tsx:49](../../../src/ui/components/VersionsPanel.tsx)).

### RecordWidget
- `RecordWidget({ onSave })` ([RecordWidget.tsx:8](../../../src/ui/components/RecordWidget.tsx)) — state machine `idle | recording | preview`.
- `startRecording` / `stopRecording` ([RecordWidget.tsx:96](../../../src/ui/components/RecordWidget.tsx)) — `getUserMedia({ audio: true })` → `MediaRecorder` (`audio/webm;codecs=opus` when supported). On stop, decodes to an `AudioBuffer` and enters `preview`. The record button is **hold-to-record** (`onMouseDown` start, `onMouseUp`/`onMouseLeave` stop) ([RecordWidget.tsx:352](../../../src/ui/components/RecordWidget.tsx)).
- Waveform draw effect ([RecordWidget.tsx:41](../../../src/ui/components/RecordWidget.tsx)) — DPR-scaled canvas sized to its container; dims out-of-trim regions, draws min/max envelope, draws two trim handles.
- `handleCanvasMouseDown/Move/Up` ([RecordWidget.tsx:228](../../../src/ui/components/RecordWidget.tsx)) — drag `trimStart`/`trimEnd` (handles within 0.03 of click; min 0.02 gap).
- `handleSave` ([RecordWidget.tsx:155](../../../src/ui/components/RecordWidget.tsx)) — slices buffer to `[trimStart, trimEnd]`, hand-encodes a 16-bit PCM WAV, names it `Audio/<sanitized>`, calls `onSave(clipName, buffer)`. `handlePreviewPlay` ([RecordWidget.tsx:140](../../../src/ui/components/RecordWidget.tsx)) plays only the trimmed region.

### TrajectoriesTab
- `TrajectoryEntry = { name, source: 'builtin'|'generated'|'custom', description? }` ([TrajectoriesTab.tsx:15](../../../src/ui/components/TrajectoriesTab.tsx)).
- `refreshList` ([TrajectoriesTab.tsx:31](../../../src/ui/components/TrajectoriesTab.tsx)) — merges the runtime registry (`listTrajectoryNames`) with IndexedDB cache (`listCachedTrajectories`); re-registers any cached LUT not yet in the registry via `registerTrajectoryFromLUT`. See [engine/spatial](../engine/spatial.md).
- `handleDelete` ([TrajectoriesTab.tsx:60](../../../src/ui/components/TrajectoriesTab.tsx)) — refuses builtins; otherwise `unregisterTrajectory` + `removeCachedTrajectory`.
- Re-runs `refreshList` when `generatingTrajectory` transitions back to `null` ([TrajectoriesTab.tsx:56](../../../src/ui/components/TrajectoriesTab.tsx)). Lists are grouped into collapsible built-in / generated / custom `Section`s.

### TrajectoryPreview
- `TrajectoryPreview({ name, size })` ([TrajectoryPreview.tsx:13](../../../src/ui/components/TrajectoryPreview.tsx)) — canvas-only (no Three.js) isometric wireframe; samples `getTrajectory(name).evaluate(t)` over 200 steps, centers around 0.5, projects with cos30/sin30, marks the start point.

### AudioLoader
- `AudioLoader({ loadedFiles, onLoadFile, onLoadBuffer })` ([AudioLoader.tsx:9](../../../src/ui/components/AudioLoader.tsx)) — file picker + drag-drop. `handleFiles` ([AudioLoader.tsx:13](../../../src/ui/components/AudioLoader.tsx)) accepts `.wav/.mp3/.ogg/.flac/.m4a/.webm`, strips the extension, names each `Audio/<name>`, calls `onLoadBuffer`. (`onLoadFile` is in the prop signature but not used by the drop/picker path.)

### TransportControls
- `TransportControls({ isPlaying, currentTime, trackCount, onPlay, onStop, onMasterVolume })` ([TransportControls.tsx:10](../../../src/ui/components/TransportControls.tsx)) — play/stop toggle (SVG triangle/square), `m:ss.cc` time readout via `formatTime`, voice count (`Nv`), master-volume range slider.

### ControlsHint
- `ControlsHint({ position? })` ([ControlsHint.tsx:12](../../../src/ui/components/ControlsHint.tsx)) — informational glass pill (drag to look · WASD move · QE fly · scroll zoom · dbl-click teleport). `pointer-events: none`; defaults to bottom-left, themed via `theme.overlay*`.

## Data flow

- `Editor.tsx` (see [editor-workspace](./editor-workspace.md)) mounts each of these inside a `Panel`, passing engine-derived props (`samples`, `engineRef`, `sketchId`, `isPlaying`, `currentTime`) and callbacks (`onLoadBuffer`, `onSave`, `onRestore`, `onGenerateTrajectory`, `onMasterVolume`).
- `ExportPanel` calls out to [engine/export](../engine/export.md) (`renderOffline`, `encodeWAV`, `downloadBlob`); reads `engineRef.current.getAudioBuffers()` for AI-generated audio.
- `TrajectoriesTab`/`TrajectoryPreview` call into [engine/spatial](../engine/spatial.md) `Trajectories` registry and `lib/trajectoryCache` (IndexedDB).
- `VersionsPanel` reads `lib/versions.getVersions`; `RecordWidget`/`AudioLoader` produce buffers consumed by the engine's sample map via `onSave`/`onLoadBuffer`.
- Theming: most panels read `useTheme()`; `ExportPanel`, `RecordWidget`, `AudioLoader`, `TransportControls` still hardcode the light palette (`#1a3a2a`, `#faf9f6`, `#d0cdc4`, `#8b0000`).

## Invariants & gotchas

- **AudioContext leaks.** Browsers cap ~6 contexts/tab. `ExportPanel` closes its preview context on unmount ([ExportPanel.tsx:40](../../../src/ui/components/ExportPanel.tsx)); `RecordWidget` closes `previewCtx` on save/discard. Don't open a context without a matching close.
- **Render-then-download (not auto-download).** `ExportPanel` stashes the rendered buffer in `previewBuffer`; the user previews, then explicitly downloads. Ambisonic preview is W-channel mono only.
- **Video export needs a live canvas + playback.** `handleStartVideoRecord` errors if no `<canvas>` is mounted (Space panel closed); audio capture relies on the global `window.__satieAudioCtx`.
- **RecordWidget hold-to-record.** Releasing or leaving the button stops recording — there is no separate stop button in `idle`/`recording`. Save sanitizes the name to `[a-zA-Z0-9_-]` and prefixes `Audio/`.
- **Trajectory cache vs registry.** `refreshList` is the source of truth that reconciles the in-memory registry with IndexedDB; builtins are never deletable. A generation finishing is detected only by `generatingTrajectory` going `string → null`.
- **DocsPanel is a custom markdown renderer**, not a library — only the subset of markdown used in `SECTIONS` is supported. Hardcoded palette here previously broke dark mode (see `docs/lessons.md` #8): module-level style objects can't see `theme`, so `navStyle`/`navBtnStyle`/`contentStyle` were converted to `(theme) => CSSProperties`. The remaining light-palette panels above are candidates for the same fix.
- **ControlsHint is decorative** — `pointer-events: none`; it must never intercept viewport input.

## Change checklist

- New asset tab → extend `AssetTab` union and add the toggle button + content branch in `AssetPanel`.
- New export format → extend `ExportFormat`, add the `renderOffline` mode + filename suffix, and confirm the engine `RenderMode` supports it ([engine/export](../engine/export.md)).
- New docs section → append to `SECTIONS`; if it uses markdown syntax beyond headings/code/tables/bold/inline-code, extend `MarkdownRenderer`.
- Touching any of these files → update this page in the same commit (wiki gate). New hardcoded hex colors → prefer `useTheme()` tokens (lessons.md #8).
- New trajectory source kind → extend `TrajectoryEntry.source` and the grouping in `TrajectoriesTab`.

## Sources

- src/ui/components/AssetPanel.tsx
- src/ui/components/DocsPanel.tsx
- src/ui/components/ExportPanel.tsx
- src/ui/components/VersionsPanel.tsx
- src/ui/components/RecordWidget.tsx
- src/ui/components/TrajectoriesTab.tsx
- src/ui/components/TrajectoryPreview.tsx
- src/ui/components/AudioLoader.tsx
- src/ui/components/TransportControls.tsx
- src/ui/components/ControlsHint.tsx
