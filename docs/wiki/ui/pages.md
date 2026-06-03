---
title: Pages — Dashboard, Gallery, Library, SketchView, UserProfile, Embed, NotFound
subsystem: ui
sources:
  - src/ui/pages/Dashboard.tsx
  - src/ui/pages/Gallery.tsx
  - src/ui/pages/Library.tsx
  - src/ui/pages/SketchView.tsx
  - src/ui/pages/UserProfile.tsx
  - src/ui/pages/Embed.tsx
  - src/ui/pages/NotFound.tsx
synced_sha: dc0da1fe00e7
synced: 2026-05-31
related: [_index.md, editor-workspace.md, chat.md, ../lib/database.md]
---

## Purpose
The routed, full-screen pages that are not the Editor or Chat: sketch management (Dashboard), public discovery (Gallery), the community sample Library, the public sketch viewer (SketchView), user profiles (UserProfile), the iframe embed player (Embed), and the 404 fallback (NotFound).

## Why it exists / responsibilities
Each file is a top-level React route component mounted by `src/main.tsx`. They own page-level data fetching (Supabase via the `lib/` clients), layout, and navigation; none of them touch the audio engine except SketchView and Embed, which mount a live `SatieEngine` to play sketches. All are lazy-loaded via `lazyRoute` in `src/main.tsx` (main.tsx:17-24).

Route map (from `src/main.tsx` `<Routes>`):

| Route | Component | File |
|-------|-----------|------|
| `/sketches` | Dashboard | Dashboard.tsx |
| `/explore` | Gallery | Gallery.tsx |
| `/library` | Library | Library.tsx |
| `/s/:id` | SketchView | SketchView.tsx |
| `/u/:username` | UserProfile | UserProfile.tsx |
| `/embed/:id` | Embed | Embed.tsx |
| `*` | NotFound | NotFound.tsx |

(`/` → Chat and `/editor[/:sketchId]` → Editor are documented on their own pages.)

## Mental model
Two tiers:

```
read-only browse/manage        play a sketch (mounts engine)
  Dashboard  (your sketches)     SketchView (/s/:id)  — full viewer
  Gallery    (public, physics)   Embed      (/embed/:id) — minimal iframe
  Library    (community samples)
  UserProfile(one author)
  NotFound   (catch-all)
```

Every page wraps itself in a full-viewport `<div>` themed from `useTheme()` and renders `<Header>` (except Embed and NotFound). Most also render `<RiverCanvas mode={mode}>` as an animated background and play ambient music via `useBackgroundMusic('/Satie-Theme.mp3', 0.08)`.

## Key types & functions

### Dashboard (`/sketches`)
- `Dashboard()` — src/ui/pages/Dashboard.tsx:173. Lists the signed-in user's sketches as a grid of cards; offers template buttons (`TEMPLATES`) and "+ New Sketch". Unauthenticated visitors get a "Welcome to Satie" prompt and may still open the editor / scaffold a template as a guest.
- `SketchCard({ sketch, onOpen, onDelete, onRename, sfx, theme })` — src/ui/pages/Dashboard.tsx:18. Card with double-click-to-rename title, script preview, public badge, delete button.
- Data: `getUserSketchesList(user.id)` (Dashboard.tsx:186). Mutations: `createSketch` (handleNew, :205 / handleNewFromTemplate, :219), `deleteSketch` (:228), `updateSketch` for rename (:237). Card click / New navigate to `/editor/:id`; guest template launch passes `{ templateTitle, templateScript }` via router `state` (:215).

### Gallery (`/explore`)
- `Gallery()` — src/ui/pages/Gallery.tsx:325. Lists ALL public sketches via `getPublicSketchesList()` (:338). Search box + `all | liked | forked` tabs (`TabKey`, :323). Cards click through to `/s/:id`.
- `usePhysics(count, version, containerRef, borderRest, borderActive)` — src/ui/pages/Gallery.tsx:62. RAF physics sim: cards drift, bounce off walls and each other, and are draggable; collisions emit a short bandpass noise burst via `collisionSound()` (:39) on a shared lazy `AudioContext` (`getCollisionCtx`, :29). Writes positions directly to DOM `.gallery-card` transforms (no React re-render per frame).
- `GalleryCard(...)` — src/ui/pages/Gallery.tsx:210. Absolutely-positioned, mouse-drag-enabled card; a drag past 5px suppresses the click-through (`totalDist`, :250).
- Only the first `INITIAL_VISIBLE = 8` (:321) cards (on the unsearched `all` tab) live in the physics canvas; the rest render in a static overflow grid below a scroll hint (:514-588).

### Library (`/library`)
- `Library()` — src/ui/pages/Library.tsx:44. Community CC0 sample browser: search, popular/recent sort, tag filters, preview playback, drag-and-drop upload.
- `SampleGraph` is **code-split** via `lazy()` (src/ui/pages/Library.tsx:28) because it pulls in Three.js (~861KB). `grid` is the default `ViewMode`; the 3D knowledge graph only loads when the user switches to `graph` view (rendered inside `<Suspense fallback={null}>`, :228).
- `graphData` — src/ui/pages/Library.tsx:191. `useMemo` that calls `buildGraph(...)` + `computeLayout(...)` from `lib/graphLayout`, only when `viewMode === 'graph'`.
- Data: `getPopularSamples`, `getRecentSamples`, `searchByText`, `searchByTags`, `getPopularTags`, `downloadCommunitySample` from `lib/communitySamples`. Search is debounced 400ms (`doSearch` via `searchTimeout`, :104).
- Upload: dropped/selected audio files decoded through a shared `AudioContext` (`getDecodeCtx`, :37), filtered by `ACCEPTED_AUDIO` (:42), queued, and published one-at-a-time through `<CommunityUploadDialog>` (:467). Preview audio via `useSamplePreview()`.
- Sub-components: `DropZoneCard` (:484), `SampleCard` (:541), `MiniWaveform` (:650), `SampleDetailPanel` (:687, slides up from bottom when a sample is selected).

### SketchView (`/s/:id`)
- `SketchView()` — src/ui/pages/SketchView.tsx:73. Full public viewer: 16:9 `SpatialViewport`, big play button, like / fork / edit / embed / share actions, and a `SatieEditor` showing the script (editable).
- Load: `getPublicSketch(id)` (:136). On success it sets the doc title, parses the `@bg` color comment, fetches the author `getProfile(s.user_id)`, checks `hasUserLiked` for the signed-in user, and loads the sketch's stored audio into the engine via `loadSketchSamples(s.id, ...)` → `engine.loadAudioBuffer` (:150). `notFound` → `EmptyState`.
- Play: `handlePlay` (:173) loads `currentScript` into the engine and plays/stops. While playing, edits hot-reload via the effect at :184.
- Like: `handleLike` (:215) toggles `likeSketch`/`unlikeSketch` (optimistic count).
- Fork: `handleFork` (:232) calls `forkSketch(user.id, sketch)` then navigates to `/editor/:forkedId`. `handleEditSubmit` (:270) opens the editor directly if owner, else forks first.
- Save edits: `handleSave` (:190) — owner updates in place (`updateSketch`); non-owner forks with the edited script.
- Embed code popover (:627) and share-link copy (`handleShare`, :245). `avatarGradient(username)` (:849) derives a deterministic gradient avatar.
- Head tracking: `useFaceTracking(setListenerOrientation)` (:108) drives the camera-based listener rotation toggle.

### UserProfile (`/u/:username`)
- `UserProfile()` — src/ui/pages/UserProfile.tsx:21. One author's public profile + their public sketch grid.
- Load: `getProfileByUsername(username)` then `getUserPublicSketchesList(p.id)` (:39-44). `notFound` → `EmptyState`.
- Owner-only inline edit of display name + bio via `upsertProfile` (`handleSaveProfile`, :54). `avatarGradient` (:13) mirrors SketchView's avatar logic. Cards navigate to `/s/:id`.

### Embed (`/embed/:id`)
- `Embed()` — src/ui/pages/Embed.tsx:12. Minimal iframe player: full-bleed `SpatialViewport`, a click-to-start play overlay, a small stop button, a `ControlsHint`, and a "satie" watermark link back to `/s/:id`.
- No Header, no auth, no like/fork. Loads via `getPublicSketch(id)` (:31); missing sketch renders "not found". Does NOT load stored samples (unlike SketchView) — it plays from `sketch.script` only (`handlePlay`, :37).

### NotFound (`*`)
- `NotFound()` — src/ui/pages/NotFound.tsx:6. Static 404 with "Go home" (`/`) and "Browse sketches" (`/explore`) buttons.

## Data flow
- Mounted by `src/main.tsx` via `lazyRoute(...)`; route params come from `useParams` (`:id`, `:username`).
- DB/storage calls go out to `lib/` clients: `lib/sketches` (CRUD, public lists, fork), `lib/likes`, `lib/profiles`, `lib/sampleStorage` (`loadSketchSamples`), `lib/communitySamples`, `lib/graphLayout`. See [database](../lib/database.md).
- SketchView and Embed mount the engine through `useSatieEngine()` and render [SpatialViewport](./viewport.md) reading `tracksRef` directly. SketchView also embeds [SatieEditor](./editor-workspace.md).
- Theming/SFX/audio chrome shared via `useTheme`, `useSFX`, `useBackgroundMusic`, and the `RiverCanvas` + `Header` components.
- Navigation targets: Dashboard/Gallery/UserProfile → `/editor/:id` or `/s/:id`; SketchView fork/edit → `/editor/:id`; Embed watermark → `/s/:id`.

## Invariants & gotchas
- **Sketch viewport bg must NOT track the viewer's page theme.** SketchView (:325) and Embed (:52) parse the `@bg #rrggbb` metadata comment from `sketch.script` (matching both `- @bg` and `# @bg` line forms) and fall back to `#000000` — switching the page light/dark must not repaint the sketch canvas. The displayed script strips the `@bg` line (SketchView.tsx:292).
- **Embed does not load stored samples**, so a sketch that relies on uploaded/AI audio buffers will play silent voices in the iframe; SketchView loads them via `loadSketchSamples`. Keep this in mind before "fixing" Embed silence.
- **Gallery physics writes transforms straight to the DOM** in a RAF loop (Gallery.tsx:189-198); the `usePhysics` effect re-inits whenever the visible sketch-id set changes (`sketchKey` / `physicsVersion`, :369-376). Don't introduce per-frame React state here.
- **Library's 3D graph is intentionally lazy.** Importing `SampleGraph` eagerly would re-add Three.js to the `/library` bundle and defeat the split (Library.tsx:26-30). The graph renders as a fullscreen background with `pointerEvents` toggled on the content layer (:260).
- Library upload, Dashboard save-as-sketch, SketchView like/fork/save, and UserProfile editing all require `user` from `useAuth()`; guarded paths silently no-op when signed out (e.g. `processAudioFiles` returns early if `!user`, Library.tsx:137).
- All these pages use inline styles and the theme tokens (no CSS modules) per `.claude/rules/ui.md`.

## Change checklist
- Adding a new route → register it in `src/main.tsx` `<Routes>` and (if lazy) add a `lazyRoute` import; consider `preloadCommonRoutes`.
- Changing a page's data source → update the corresponding `lib/` client and link it here.
- Touching SketchView/Embed playback or `@bg` parsing → keep both files in sync (they duplicate the bg-match + fallback logic) and re-verify sample loading.
- Adding/removing a sub-component in these files → update the line refs in this page and run `npm run wiki:gate`.
- Any edit under these source files must update this page in the same commit (`.claude/rules/wiki.md`).

## Sources
- src/ui/pages/Dashboard.tsx
- src/ui/pages/Gallery.tsx
- src/ui/pages/Library.tsx
- src/ui/pages/SketchView.tsx
- src/ui/pages/UserProfile.tsx
- src/ui/pages/Embed.tsx
- src/ui/pages/NotFound.tsx
