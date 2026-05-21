# Handoff — Cross-region Latency Pass (2026-05-11)

Previous session diagnosed and fixed massive tab-load latency reported from Peru against a US-region Supabase. User confirmed "improved a lot" after the fixes shipped. Next session should pick up where this left off if more latency work is needed.

## 1. What was wrong and what shipped

The original "10s tab navigation" was **not** a Supabase round-trip problem despite the cross-region setup. The biggest culprit was a 33 MB `Satie-Theme.wav` being fetched on every page that uses `useBackgroundMusic` (Chat, Dashboard, Gallery, Library), saturating Peru→US bandwidth and starving every other request behind it. Underneath that, several list queries were also pulling full script bodies they didn't need.

Fixes shipped in this session:

| Fix | Files |
|-----|-------|
| **Background music: deferred fetch + 33 MB → 2.8 MB MP3** | `src/ui/hooks/useBackgroundMusic.ts`, `public/Satie-Theme.mp3` (WAV deleted), 4 page callers |
| **`script_preview` generated column** — `substring(script, 1, 200) STORED` | `supabase/migrations/009_script_preview.sql` (applied via `npx supabase db query --linked`, verified live) |
| **`SketchListItem` type** + list-query variants that omit `script` | `src/lib/supabase.ts`, `src/lib/sketches.ts` (`getUserSketchesList`, `getPublicSketchesList`, `getUserPublicSketchesList`) |
| **Batched profile fetch** — single `.in('id', ids)` instead of N round-trips | `src/lib/profiles.ts` (`getProfilesByIds`), `src/ui/pages/Chat.tsx` |
| **Drop 1536-dim embedding from community sample list queries** | `src/lib/communitySamples.ts` (new `COMMUNITY_LIST_COLS`, `getPopularSampleNames` for editor autocomplete) |
| **SessionStorage cache for list queries** with TTL + invalidation on mutation | `src/lib/queryCache.ts`; sketches.ts invalidates on create/update/delete/fork |
| **Editor: parallelize script + samples load** | `src/ui/pages/Editor.tsx` (loadSketchSamples fires concurrently with getSketch) |
| **Non-blocking auth bootstrap** — only block render when localStorage has a `sb-*-auth-token` | `src/lib/AuthContext.tsx` (`hasStoredSession()`) |
| **Cache-Control: immutable** for `/assets/*` and any audio file in `vercel.json` | `vercel.json` |

`npm run build` clean, `npm run test` 258/258 passing on the final commit.

## 2. Things still on the table if latency complaints return

Confirmed-suspect, **not yet fixed**:

- **Monaco's `ts.worker` is 7 MB** in the build output (`dist/assets/ts.worker-*.js`). Satie uses a custom Monarch tokenizer and registers no built-in language, so the TS/HTML/CSS/JSON workers should never fire — but `@monaco-editor/react` bundles them anyway. If `/editor` specifically becomes the slow tab, strip unused languages via `@monaco-editor/loader` config or switch to a leaner Monaco distribution.
- **Main bundle `index-*.js` is 197 KB gzipped, vendor-three is 325 KB gzipped.** Both are cached after first load but contribute to first-paint over slow links. Three.js is only needed on Chat (overlay viewport) and Editor — Dashboard/Gallery/UserProfile pull it in too via the main bundle. Splitting the main bundle by route would help.
- **Vercel project region.** Hasn't been confirmed but Supabase is US. If the Vercel project is also us-east-1 and most users are LATAM, consider adding sa-east-1 to Functions / setting a closer primary region. Don't do this without checking user location distribution first.

## 3. How to verify if user reports slowness again

Don't speculate. Ask user to:
1. Open DevTools → Network in Brave on production.
2. Hard refresh (Cmd+Shift+R), then navigate between two tabs.
3. Screenshot the network panel + paste back.

Look for: any request >500 KB, any request >2s, any obvious waterfall. The 33 MB WAV would have jumped out instantly — the next bottleneck will too.

`sessionStorage` cache keys to know:
- `sketches:user:<userId>` (30s TTL)
- `sketches:public` (60s TTL)
- `sketches:user-public:<userId>` (30s TTL)
- `community:popular:<limit>` (5 min)
- `community:popular-names:<limit>` (10 min)

Invalidation happens automatically inside `createSketch` / `updateSketch` / `deleteSketch` / `forkSketch`.

## 4. False alarms — don't re-investigate

These were considered and ruled out during the latency pass:

- **AuthContext `getSession()` blocking** — fixed; only blocks when a stored token exists.
- **Sequential SketchView loads** — exists (`SketchView.tsx:136-157` runs `getProfile` then `hasUserLiked` after `getPublicSketch`) but small impact compared to the WAV. Skipped this round.
- **Splash screen blocking each route** — checked, only fires once per session via component state. Not the issue.
- **Supabase RLS full-table scans** — checked migration 008 (foreign key indexes); not the issue.

## 5. Prior session's frontend audit fixes (still valid, don't regress)

From the 2026-04-22 audit (now archived):

- **Chat save-as-sketch await** at `src/ui/pages/Chat.tsx` — must await sample upload before navigating to editor.
- **ExportPanel AudioContext leak** in `src/ui/components/ExportPanel.tsx` — closed on panel teardown.
- **SketchView fork try/finally** at `src/ui/pages/SketchView.tsx` — guards against double-fork.
- **Chat scroll-to-bottom** uses `useLayoutEffect` to read post-commit scrollHeight.

Re-audited "false alarms" from that pass (still false):

- `SatieEditor.tsx` module-level `languageRegistered` flag prevents duplicate Monaco registration.
- `Editor.tsx` save-as-new updates `currentSketchId` correctly.
- `OverlayFlyControls` keeps `isInputFocused` in deps and reads `document.activeElement` live.
- `useHeadTracking` re-runs on `[enabled]` toggle.
- `ChatMessage` autofocus is intentional.
- StrictMode double-AudioContext is guarded by `engine.destroy()` before re-init.

## 6. Known-suspect, low-priority

- `useSFX.ts` — module-level shared AudioContext never closed. Deliberate singleton.
- `RecordWidget` drag handlers capture `trimStart` / `trimEnd` from closure.
- Fork doesn't copy samples — references original author's storage path.
- Editor autosave timer cleanup on unmount — theoretical `setState`-after-unmount.

## 7. Environment snapshot

- Branch: `main`.
- Supabase migrations live: 001–009. **009_script_preview** is applied via `npx -y supabase@latest db query --linked` (verified — column exists as `text, ALWAYS`).
- `supabase` CLI is not on PATH; brew install failed due to outdated Xcode CLT. Use `npx supabase@latest <cmd>`.
- ffmpeg is installed at `/opt/homebrew/bin/ffmpeg`.
- `npm run build`: clean.
- `npm run test`: 258/258 passing.
- Dev server: `npm run dev` — picks next free port starting at 5173.
- Git user: Mateo Larrea. Do not commit unless asked.

## 8. Recent commits not to regress

Push from this session contained:
- Defer + compress background music; add asset cache headers.
- Add `SketchListItem` + list-query variants; cache list queries in sessionStorage.
- Batch profile fetches in Chat; parallelize Editor script/sample load.
- Non-blocking auth bootstrap.
- Migration 009: `sketches.script_preview` generated column.

## Tone reminder

User memory covers this, but in case it didn't load: terse, no emojis, fix root causes, don't add cleanup/abstractions beyond the task. Group script statements are unindented — don't reformat existing `.satie` scripts. Use `npx supabase db query --linked` for DB work (network blocks direct Postgres).
