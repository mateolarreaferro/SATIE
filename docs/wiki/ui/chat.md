---
title: Chat — landing page & message UI
subsystem: ui
sources:
  - src/ui/pages/Chat.tsx
  - src/ui/components/ChatMessage.tsx
  - src/ui/components/ChatInput.tsx
synced_sha: e566602a0c4c
synced: 2026-05-31
related: [ai-panel.md, viewport.md, ../lib/ai-pipeline.md]
---

## Purpose
The default landing page (`/`): a ChatGPT-style interface where users describe a 3D soundscape in plain language and Satie generates, plays, and visualizes it live.

## Why it exists / responsibilities
`Chat` is the product's front door. It must:
- Take a natural-language prompt, run it through the AI generation pipeline, and play the resulting Satie script through the live engine.
- Support **iterative refinement** — "add more reverb" must work, so it threads recent conversation history into each `generateCode` call.
- Visualize moving voices in 3D *behind* the chat UI without stealing pointer events from it.
- Gate generation behind auth and an available AI provider (credits or API key) + a per-session budget.
- Let users promote a generated soundscape into a persisted, shareable sketch (`save as sketch`), uploading engine audio buffers so the editor isn't silent on landing.

`ChatMessage` renders one message bubble (user or assistant) including the collapsible/editable script and feedback controls. `ChatInput` is the glassmorphism prompt bar.

## Mental model
Three stacked full-screen layers inside one relative container, painted bottom→top:

```
z:2  Chat UI (Header, messages, ChatInput)  pointerEvents:none wrapper,
                                            children opt back in with 'auto'
z:1  SpatialViewport overlayMode            transparent WebGL, mounted only
                                            when hasActiveTracks
z:0  RiverCanvas                            2D particle animation (mode-driven)
 -   container background                   theme.bg (day/night cycle)
```

Because the z:2 wrapper sets `pointerEvents: 'none'`, camera gestures (right-click orbit, WASD fly via `OverlayFlyControls`) fall through to the viewport below, while interactive chat regions (`isEmpty` landing div, message scroller, `ChatInput`) re-enable `pointerEvents: 'auto'`.

The page has two top-level visual states keyed on `messages.length === 0`:
- **Landing (`isEmpty`)** — hero + suggestion presets + input + scroll-down community grid.
- **Active conversation** — scrollable message list + `ControlsHint` + input.

## Key types & functions
- `Chat()` — the page component. src/ui/pages/Chat.tsx:209
- `sendMessage(prompt)` — the core flow: auth check → provider/budget guards → append user+assistant messages → build history → `generateCode` → load+play script → save RLHF feedback. src/ui/pages/Chat.tsx:280
- `sendPreset(title, desc)` — bypasses AI for the three hand-crafted `SUGGESTION_PRESETS`; falls back to `sendMessage` if no preset exists. src/ui/pages/Chat.tsx:376
- `handleSaveAsSketch(script, prompt, messageId)` — `createSketch` then encode every engine audio buffer to WAV and `uploadSketchSamples`, then `navigate('/editor/:id')`. src/ui/pages/Chat.tsx:401
- `handleScriptEdit(messageId, newScript)` — applies an inline edit: updates the message, `setCurrentScript`, `loadScript`, and plays. src/ui/pages/Chat.tsx:444
- `handleRate(messageId, rating)` — toggles thumbs up/down, persists via `updateFeedback`. src/ui/pages/Chat.tsx:435
- `cleanSketchTitle(prompt)` — derives a clean title (trims, word-boundary cut at 60, drops trailing stop-words, capitalizes). src/ui/pages/Chat.tsx:46
- `SUGGESTION_PRESETS` — title → ready-made Satie script for instant demos. src/ui/pages/Chat.tsx:84
- `ChatMessageData` interface — message shape (`role`, `content`, `script?`, `status`, `error?`, `feedbackId?`, `rating?`). src/ui/components/ChatMessage.tsx:7
- `ChatMessage(props)` — bubble renderer; assistant variant switches on `status` (`generating` / `error` / `playing` / `done`). src/ui/components/ChatMessage.tsx:402
- `EditableScript(...)` — collapsed-by-default inline preview + fullscreen Monaco modal (`createPortal` to `document.body`), Cmd/Ctrl+Enter to run, Esc to close. src/ui/components/ChatMessage.tsx:53
- `ChatInput(props)` — controlled text input; Enter (no Shift) sends, clears on send. src/ui/components/ChatInput.tsx:10

## Data flow
Inbound: routed at `/` from `main.tsx`. Reads `useAuth` (user + sign-in methods), `useTheme` (mode/theme), and `useSatieEngine` for engine control (`loadScript`, `play`, `stop`, `tracksRef`, listener pose setters, community-sample wiring).

Outbound:
- `generateCode(prompt, currentScript, [], history)` → [ai pipeline](../lib/ai-pipeline.md). `loadedSamples` is always `[]` in chat mode — the model uses `gen` blocks. The current script is sent via the pipeline's enriched prompt, so `history` carries only the last 6 entries (3 pairs) as summaries (assistant entries become `[generated N line script]` to keep tokens low). src/ui/pages/Chat.tsx:332
- `loadScript` / `play` / `stop` on the engine hook — see [hooks](./hooks.md).
- `<SpatialViewport ... overlayMode>` — lazy-loaded (code-split Three.js), mounted only when `hasActiveTracks`; receives `tracksRef` and listener-pose callbacks. See [viewport](./viewport.md).
- `createSketch` / `uploadSketchSamples` / `getPublicSketchesList` / `getProfilesByIds` — Supabase-backed sketch + profile data.
- `createProvider` / `checkBudget` (aiProvider), `createFeedbackEntry` / `saveFeedback` / `updateFeedback` (feedbackStore), community sample resolution (`downloadCommunitySampleByName`, `findCommunityMatch`, `getPreferCommunitySamples`).

`ChatMessage` calls back up via `onSaveAsSketch`, `onRate`, `onScriptEdit`; `ChatInput` calls `onSend`. The `AIPanel` is the editor-side sibling that reuses the same pipeline.

## Invariants & gotchas
- **Auth gate is soft, not blocking.** Unauthenticated `sendMessage`/`sendPreset` set `showSignInPrompt` and return — they do not throw or navigate. src/ui/pages/Chat.tsx:284
- **Provider + budget guards run before any AI call.** A missing provider or an over-budget session pushes an `error`-status assistant message (with the user message) instead of generating. src/ui/pages/Chat.tsx:290
- **Script is only loaded if it contains a voice.** The result is gated on `/\b(loop|oneshot)\b/` before `setCurrentScript` + `loadScript`; prose-only responses don't touch the engine. src/ui/pages/Chat.tsx:349
- **`hasActiveTracks` is poll-driven** — a 500ms interval reads `tracksRef.current.length`. The overlay viewport mounts/unmounts off this boolean, so there's up to ~500ms lag after `stop()` (mitigated by `handleStop` setting it false immediately). src/ui/pages/Chat.tsx:246
- **Three.js reads `tracksRef` directly** in its render loop — never insert React state between the engine and the viewport (project rule).
- **Pointer-events inversion is load-bearing.** The z:2 chat wrapper is `pointerEvents:none`; only interactive subtrees re-enable it. Removing/adding `auto` wrongly will either eat camera gestures or make chat unclickable. src/ui/pages/Chat.tsx:518
- **Background music stops on first generation** (`stopBackgroundMusic()` in both `sendMessage` and `sendPreset`).
- **Saving uploads WAV-encoded buffers and awaits them** so `/editor/:id` isn't silent; `savingSketchId` guards re-entry while the upload is in flight. src/ui/pages/Chat.tsx:412
- **`EditableScript` defaults collapsed** (`collapsed = true`) — chat shows a one-line "script" hint; the inline preview and the fullscreen modal are opt-in. src/ui/components/ChatMessage.tsx:64
- **Modal swallows key events** — the expanded editor overlay calls `e.stopPropagation()` on `onKeyDown` so typing never leaks to fly controls. src/ui/components/ChatMessage.tsx:251
- Monaco dark/light theme in `EditableScript` is chosen by computing luminance of `theme.bg` hex, not by mode flag. src/ui/components/ChatMessage.tsx:95
- `ChatInput` sends on Enter without Shift; Shift+Enter is a no-op here (single-line `<input>`, not a textarea). src/ui/components/ChatInput.tsx:21

## Change checklist
- Adding a message status? Extend `ChatMessageData.status` (src/ui/components/ChatMessage.tsx:12) and add its render branch in `ChatMessage`'s assistant block.
- Changing what history the model sees? Edit the `history` map in `sendMessage` (keep it summarized, not full scripts) — src/ui/pages/Chat.tsx:332.
- Adding a suggestion preset? Add to `SUGGESTIONS` (icon + copy) and `SUGGESTION_PRESETS` (script) so `sendPreset` finds it.
- Touching the layer stack / pointer-events? Re-verify camera passthrough and chat clickability against the z:0–z:2 ordering.
- Changing generation gating? Update the provider/budget/auth guards together and keep the voice-presence regex in sync with engine voice keywords.
- Any edit to these three files updates this page in the same commit (wiki gate).

## Sources
- src/ui/pages/Chat.tsx
- src/ui/components/ChatMessage.tsx
- src/ui/components/ChatInput.tsx
