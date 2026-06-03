---
title: Community UI — upload, samples, graph, feedback
subsystem: ui
sources:
  - src/ui/components/CommunityUploadDialog.tsx
  - src/ui/components/CommunityTab.tsx
  - src/ui/components/FeedbackDashboard.tsx
  - src/ui/components/SampleGraph.tsx
  - src/ui/components/SamplesTab.tsx
synced_sha: 69480602e23c
synced: 2026-05-31
related: [../lib/community.md, ../lib/performance.md]
---

## Purpose

The React surface for the community sample library: importing/recording local samples, sharing them (CC0) via an upload dialog, browsing/searching community samples, the lazy-loaded 3D knowledge graph, and a read-only RLHF feedback dashboard.

## Why it exists / responsibilities

These five components are the user-facing front-end for the [community library](../lib/community.md) and [feedback store](../lib/ai-pipeline.md). Each owns one concern:

- **SamplesTab** — local sketch samples (imported / generated / recorded), grouped + collapsible, with import / record / preview / delete.
- **CommunityTab** — browse, search, preview, and add community samples to the current sketch; drop zone that queues files for sharing.
- **CommunityUploadDialog** — the share-to-community modal: analyze audio, interactive waveform, AI-suggested tags, CC0 publish.
- **SampleGraph** — a Three.js force-laid knowledge graph of community samples; heavy, so it is `lazy()`-loaded by `Library.tsx`.
- **FeedbackDashboard** — read-only stats on which DSL patterns the user prefers, derived locally from IndexedDB feedback. Injects nothing into prompts.

## Mental model

```
AssetPanel ── SamplesTab        (local sketch samples)
           └─ CommunityTab ──── CommunityUploadDialog   (share flow, queued)
                  │
                  └─ lib/communitySamples (browse / search / download / upload)

Library page ── lazy(SampleGraph)   (3D graph; Three.js)
             └─ CommunityUploadDialog (also reused here)

Header (settings) ── FeedbackDashboard  (read-only, IndexedDB only)
```

The upload dialog is shared by both `CommunityTab` (AssetPanel) and `Library.tsx`. The graph and the feedback dashboard are read-only views — they never write.

## Key types & functions

### SamplesTab
- `SampleEntry` — `{ name; category: 'imported' | 'generated' | 'recorded' }` (src/ui/components/SamplesTab.tsx:4).
- `SamplesTab({ samples, onLoadBuffer, onDelete, onPreview })` (src/ui/components/SamplesTab.tsx:131) — splits `samples` by category into three `CategorySection`s; embeds `RecordWidget`.
- `handleFiles` (src/ui/components/SamplesTab.tsx:141) — filters to accepted audio extensions, names each `Audio/<basename>`, calls `onLoadBuffer`.
- `CategorySection` (src/ui/components/SamplesTab.tsx:16) — collapsible group; renders nothing when empty.

### CommunityTab
- `CommunityTab({ onLoadBuffer })` (src/ui/components/CommunityTab.tsx:28) — `onLoadBuffer` is the AssetPanel's loader (same signature as SamplesTab's).
- `processAudioFiles` (src/ui/components/CommunityTab.tsx:73) — decodes dropped/selected files via a shared `_decodeCtx` AudioContext and pushes `{ buffer, name }` onto `uploadQueue`. Requires `user`.
- `handleSearch` (src/ui/components/CommunityTab.tsx:47) — empty query → `getPopularSamples(30)`; otherwise `searchByText(query, 20)`.
- `handleAdd` (src/ui/components/CommunityTab.tsx:113) — downloads (and caches in `previewBuffers`) then `onLoadBuffer('community/<name>', buffer, 'imported')`.
- `handlePreview` (src/ui/components/CommunityTab.tsx:63) — lazy-download + `useSamplePreview().play`.

### CommunityUploadDialog
- `CommunityUploadDialogProps` (src/ui/components/CommunityUploadDialog.tsx:11) — `{ audioBuffer, fileName, userId, onClose, onUploaded, queueRemaining? }`.
- `CommunityUploadDialog(...)` (src/ui/components/CommunityUploadDialog.tsx:28) — phase machine `'analyzing' | 'editing' | 'uploading' | 'done' | 'error'`.
- On mount (src/ui/components/CommunityUploadDialog.tsx:60): `analyzeAudioBuffer` (sync) → `editing`, then best-effort `suggestTags(fileName, features)` for tags + description.
- `drawWaveform` (src/ui/components/CommunityUploadDialog.tsx:89) — canvas bars colored by play progress / hover; seek via `handleWaveformClick`.
- `handlePublish` (src/ui/components/CommunityUploadDialog.tsx:239) — `audioBufferToWav` → `computeEmbedding(name, description, tags)` → `uploadCommunitySample({...})`.
- `audioBufferToWav` (src/ui/components/CommunityUploadDialog.tsx:607) — local minimal 16-bit PCM WAV encoder (not the engine's WAVEncoder).

### SampleGraph
- `SampleGraphProps` (src/ui/components/SampleGraph.tsx:21) — `{ nodes: GraphNode[]; edges: GraphEdge[]; onSelect; selectedId; highlightIds: Set<string> | null; theme }`. `GraphNode`/`GraphEdge` come from `lib/graphLayout`.
- `SampleGraph(...)` (src/ui/components/SampleGraph.tsx:34) — R3F `Canvas` with transparent clear color, exponential fog matching `theme.bg`, auto-rotating `OrbitControls`.
- `GraphContent` (src/ui/components/SampleGraph.tsx:93) — builds a `neighborMap` from edges; renders `Edges` + one `Node` per node.
- `Node` (src/ui/components/SampleGraph.tsx:134) — per-frame breathing scale, Y-float, opacity/emissive lerp; radius scales with `log2(downloadCount + 1)`; selected node lerps to `HIGHLIGHT` (#3b82f6); always-on `Html` label, tags shown on hover.
- `Edges` (src/ui/components/SampleGraph.tsx:257) — single `lineSegments` with vertex colors; recolors by selection (connected = blue, neighbor = faint, else nearly invisible); per-frame Y offset to follow node float.
- Edges index nodes positionally: `nodes[e.source]` / `nodes[e.target]` (src/ui/components/SampleGraph.tsx:100, :271) — `source`/`target` are array indices, not ids.

### FeedbackDashboard
- `FeedbackDashboardProps` (src/ui/components/FeedbackDashboard.tsx:11) — `{ theme }`.
- `PATTERN_DETECTORS` (src/ui/components/FeedbackDashboard.tsx:36) — regex tests detecting DSL patterns (count multipliers, groups, reverb, delay, filter, interpolation, ranges, movement, trajectory, visual trails, gen audio, variables).
- `FeedbackDashboard({ theme })` (src/ui/components/FeedbackDashboard.tsx:51) — on mount runs `getTopExamples('script', 20)` + `getAntiPatterns('script', 20)`, computes `successRate = posHits / (posHits + negHits)` per pattern (0.5 when no data), sorts by sample size. Positive hits test `userEditedOutput ?? output`.

## Data flow

- `SamplesTab` and `CommunityTab` are both rendered by `AssetPanel.tsx` (the Samples / Community tabs); both call the panel's `onLoadBuffer` to add audio into the engine. See [editor-workspace](./editor-workspace.md) for the AssetPanel and its buffer loader.
- `CommunityTab` → `lib/communitySamples` (`getPopularSamples`, `searchByText`, `downloadCommunitySample`) and queues shares into `CommunityUploadDialog`. See [community](../lib/community.md).
- `CommunityUploadDialog` → `lib/audioAnalysis` (`analyzeAudioBuffer`), `lib/communityTagging` (`suggestTags`, `computeEmbedding`), `lib/communitySamples` (`uploadCommunitySample`). See [audio-analysis](../lib/audio-analysis.md), [community](../lib/community.md).
- `SampleGraph` is `lazy()`-imported in `Library.tsx` (src/ui/pages/Library.tsx:28); it receives `nodes`/`edges` produced by `lib/graphLayout`. The Library page also reuses `CommunityUploadDialog` for sharing.
- `FeedbackDashboard` is rendered inside `Header.tsx` settings (src/ui/components/Header.tsx:661); reads only `lib/feedbackStore`. The write side of that data lives in `lib/aiGenerate.ts` (src/lib/aiGenerate.ts:954). See [ai-pipeline](../lib/ai-pipeline.md).

## Invariants & gotchas

- **`SampleGraph` is heavy (pulls in Three.js) and must stay lazy.** It is loaded behind the graph view via `lazy()`; loading it eagerly would bloat the Library route chunk. See docs/lessons.md "Routing & bundling" #3 and #4 (code-splitting moves cost to first navigation; a static import of a conditionally-rendered component still bundles its full dep tree) and the bundle-split notes in [performance](../lib/performance.md).
- **Edges reference nodes by array index**, not id: `nodes[e.source]` / `nodes[e.target]`. Reordering `nodes` without rebuilding `edges` corrupts the graph.
- **FeedbackDashboard is strictly read-only** and IndexedDB-only — no API calls, no prompt injection (header comment in src/ui/components/FeedbackDashboard.tsx:1). Don't wire it into the AI prompt path.
- `successRate` defaults to **0.5** with zero samples; bars/labels render as "insufficient data" / "—" when `sampleSize < 2`. Don't treat 50% as a real signal.
- **Upload requires a signed-in user** — `CommunityTab` hides the drop zone and `processAudioFiles` early-returns when `user` is null.
- **Shares are queued one-at-a-time.** `CommunityTab` keeps `uploadQueue`; the dialog shows `queueRemaining` and the close button becomes "skip" (`→`) vs "close" (`×`). `key={currentUpload.name + uploadQueue.length}` forces a fresh dialog per file.
- **Two separate WAV encoders exist**: `CommunityUploadDialog.audioBufferToWav` (local, 16-bit) is distinct from the engine's `WAVEncoder`. Keep that in mind when changing export fidelity.
- **AudioContexts are module-level singletons**: `_ctx` (preview, src/ui/components/CommunityUploadDialog.tsx:21) and `_decodeCtx` (decode, src/ui/components/CommunityTab.tsx:18). They resume/recreate on `closed`/`suspended` — honor the user-gesture constraint (see .claude/rules/ui.md).
- `SamplesTab` prefixes imports with `Audio/`; `CommunityTab.handleAdd` prefixes community adds with `community/`. The displayed name strips `Audio/` (src/ui/components/SamplesTab.tsx:87).
- Tags are normalized to trimmed lowercase and de-duped on add (src/ui/components/CommunityUploadDialog.tsx:225); clicking a tag chip removes it.

## Change checklist

- Changing `SampleGraph` props or `GraphNode`/`GraphEdge` shape → update `lib/graphLayout` and the consumer in `Library.tsx`.
- Adding a new DSL pattern worth tracking → add a `PATTERN_DETECTORS` entry **and** a `PATTERN_LABELS` entry (src/ui/components/FeedbackDashboard.tsx:21, :36).
- Changing the upload payload → keep `CommunityUploadDialog.handlePublish` in sync with `uploadCommunitySample` and the community schema ([community](../lib/community.md)).
- Adding a new sample category → extend `SampleEntry['category']` (src/ui/components/SamplesTab.tsx:4) and add a `CategorySection` render.
- Keeping the graph lazy: don't statically import `SampleGraph` anywhere; verify the bundle split per [performance](../lib/performance.md).
- Touched any of these files → update this page in the same commit (wiki gate).

## Sources

- src/ui/components/CommunityUploadDialog.tsx
- src/ui/components/CommunityTab.tsx
- src/ui/components/FeedbackDashboard.tsx
- src/ui/components/SampleGraph.tsx
- src/ui/components/SamplesTab.tsx
