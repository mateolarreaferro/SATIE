# Handoff — Frontend Audit (2026-04-22)

Read this first. Previous session audited the frontend and shipped fixes; Playwright MCP is configured but not yet activated. Your job is to activate it and smoke-test the fixes in-browser.

## 1. Activate Playwright MCP (first thing)

`.mcp.json` at the repo root is configured for `@playwright/mcp@latest` with `vision,devtools` caps. It needs one-time approval.

- Run `/mcp` — if `playwright` is not connected, Claude Code should have prompted you to approve the project-scope MCP on session start. Approve it.
- Confirm you see `mcp__playwright__browser_navigate`, `_click`, `_type`, `_screenshot`, `_console_messages` in your tool list.
- First invocation downloads ~150MB Chromium; expect a delay.

If the user wants headless mode, add `"--headless"` to `.mcp.json`'s `args` array.

## 2. Smoke-test the four fixes from last session

Start dev server (`npm run dev`), then drive the browser via MCP:

| Fix | How to verify |
|-----|---------------|
| **Chat save-as-sketch await** (`src/ui/pages/Chat.tsx:362`) | Sign in → generate a soundscape on `/` → click "Save as sketch". The nav to `/editor/:id` should only happen after samples are uploaded; check console has no "sample not found" warnings and audio plays on editor load. |
| **ExportPanel AudioContext leak** (`src/ui/components/ExportPanel.tsx`) | Open a sketch in editor → open Export panel → render + preview an audio file → close the panel (toggle it off in sidebar). Inspect `window.__satieAudioCtx` is untouched and no "AudioContext closed" errors surface. Repeat 6+ times without refresh; previously would hit browser context cap. |
| **SketchView fork try/finally** (`src/ui/pages/SketchView.tsx:162, 182`) | Open a public sketch at `/s/:id` as a non-owner → rapid-click Fork twice. Should create exactly one forked sketch. Check DB via Supabase or just that `/editor/:id` loaded with a single new ID. |
| **Chat scroll-to-bottom race** (`src/ui/pages/Chat.tsx:215`) | Send several prompts in quick succession on `/`. After each send, the viewport should scroll to the newest message (not stop short at the prior one). |

Take screenshots on any step that visually matters — especially viewport trail rendering — so there's a record.

## 3. False alarms already ruled out — don't re-propose

Three Explore agents surfaced these; I verified each is *not* a bug. If you see them flagged again, they've already been investigated:

- **"Monaco providers duplicate on remount"** — `SatieEditor.tsx:81` has a `languageRegistered` module-level flag. Guarded.
- **"Editor.tsx stale sketch ID after save-as-new"** — `setCurrentSketchId(sketch.id)` at line 589 updates state; subsequent saves reference current state correctly.
- **"OverlayFlyControls stale `isInputFocused`"** — `isInputFocused` IS in `onKeyDown`'s deps (line 778), reads `document.activeElement` live.
- **"useHeadTracking iOS permission not re-requested"** — Effect is keyed to `[enabled]`; toggling re-runs and re-requests.
- **"ChatMessage autofocus steals input"** — Intentional; focus only fires when the user clicks to expand.
- **"StrictMode double-AudioContext leak"** — Cleanup calls `engine.destroy()` before re-init; production-safe.

## 4. Known-suspect areas worth a deeper look later

These came up in the audit but weren't prioritized by the user. If you get asked for another pass, start here:

- **`useSFX.ts`** — module-level shared `AudioContext` never closed. Deliberate singleton pattern; only fix if a concrete issue appears.
- **RecordWidget drag handlers** (`src/ui/components/RecordWidget.tsx:236-247`) — canvas mousemove handlers capture `trimStart`/`trimEnd` from closure. Could introduce ref-based reads.
- **Fork doesn't copy samples** (`src/lib/sketches.ts:90-108`) — forked sketch references original author's storage path. If they delete, fork breaks. Product decision, not a bug per se.
- **Editor autosave timer cleanup on unmount** (`src/ui/pages/Editor.tsx:356-363`) — theoretical `setState`-after-unmount; unverified impact.

## 5. Environment snapshot

- Branch: `main`, clean except `docs/` (untracked).
- `npm run build`: clean.
- `npm run test`: 258/258 passing.
- Dev server: `npm run dev` — picks next free port starting at 5173.
- Git user: Mateo Larrea. Do not commit unless asked.

## 6. Recent commits not to regress

- `e0aa99e editable script`
- `0c8e49b Sketch view Fixes`
- `9a4b8ea fix audio buffer campture + sketch view improvements`

## Tone reminder

User's memory covers this, but in case it didn't load: terse, no emojis, fix root causes, don't add cleanup/abstractions beyond the task. Group script statements are unindented — don't reformat existing `.satie` scripts.
