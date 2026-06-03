---
title: AI panel — AIPanel.tsx
subsystem: ui
sources:
  - src/ui/components/AIPanel.tsx
synced_sha: cac0cafc8116
synced: 2026-05-31
related: [../lib/ai-pipeline.md, chat.md]
---

# AI panel — AIPanel.tsx

## Purpose
The editor's multi-provider AI generation panel: a prompt log + input bar that drives the [AI pipeline](../lib/ai-pipeline.md) to generate Satie scripts, samples, or trajectories, with ensemble/refine modes, voice input, generation history, and RLHF rating.

## Why it exists / responsibilities
`AIPanel` is the thin React shell around the pure generation logic in `src/lib/aiGenerate.ts`. It owns no generation algorithms — those were extracted to `lib/aiGenerate.ts` (see the NOTE comment at `src/ui/components/AIPanel.tsx:128`). Its jobs:

- Switch among three generation **targets** (`script` / `sample` / `trajectory`) and let the user pick the AI provider.
- Collect prompts (typed or spoken via push-to-talk Whisper ASR) and dispatch them to the right pipeline function.
- Surface cost/budget status, an ensemble toggle, and a refine button (script mode only).
- Maintain a linear **history stack** so the user can step back/forward through generations and restore an earlier script.
- Capture RLHF feedback (thumbs up/down, undo tracking) into the feedback store for later training.

It does **not** mutate the editor directly: results are handed up to the parent (`Editor.tsx`) via `onGenerate` / `onGenerateSample` / `onGenerateTrajectory` callbacks.

## Mental model
```
input/mic ─▶ sendPrompt(prompt)
                │ target switch
                ├─ 'trajectory' ─▶ generateTrajectoryFromPrompt ─▶ onGenerateTrajectory
                ├─ 'sample'     ─▶ generateSampleSpec           ─▶ onGenerateSample
                └─ 'script'     ─▶ generateCode | generateEnsemble ─▶ onGenerate
                                                │
                       every result ──▶ createFeedbackEntry/saveFeedback ──▶ history stack
refine button ─▶ refineScript ─▶ onGenerate (+ history entry)
```
The component is presentational + orchestration only. All the "intelligence" lives one layer down in `lib/aiGenerate.ts` and `lib/aiProvider.ts`.

## Key types & functions
- `AITarget` (`src/ui/components/AIPanel.tsx:25`) — `'script' | 'sample' | 'trajectory'`, the exported union driving the target selector.
- `AIPanelProps` (`src/ui/components/AIPanel.tsx:27`) — the public surface. Notable: `onGenerate(code)`, `onGenerateSample(name, prompt)`, optional `onGenerateTrajectory(name, prompt)`, `currentScript`, `loadedSamples`, controlled `target` + `onTargetChange`, and `onFeedbackCreated(feedbackId, baseline)` (used by the parent to track implicit edits).
- `HistoryEntry` (`src/ui/components/AIPanel.tsx:39`) — `{ prompt, result, timestamp, target, feedbackId }`; the unit of the history stack.
- `transcribeAudio(audioBlob)` (`src/ui/components/AIPanel.tsx:49`) — posts the recorded blob to OpenAI `whisper-1`; requires the `satie-openai-key` in localStorage regardless of the selected text provider.
- `useASR(onTranscription, onError)` (`src/ui/components/AIPanel.tsx:70`) — push-to-talk hook wrapping `MediaRecorder` (webm/opus). Drops recordings under 300ms; returns `{ recording, transcribing, start, stop }`.
- `AIPanel(props)` (`src/ui/components/AIPanel.tsx:133`) — the component.
- `sendPrompt(prompt)` (`src/ui/components/AIPanel.tsx:187`) — the central dispatcher: validates a provider exists (`createProvider()`), runs the budget guard (`checkBudget()`), branches on `target`, applies the generation, saves feedback, and pushes a `HistoryEntry`.
- `restoreHistory(index)` (`src/ui/components/AIPanel.tsx:169`) — navigates the history stack; marks the entry navigated away from as `wasUndone` in the feedback store, and re-applies a restored script via `onGenerate` only if it contains `loop` or `oneshot`.
- `handleRate(rating)` (`src/ui/components/AIPanel.tsx:355`) — toggles a 1/-1 RLHF rating on the active history entry and writes it via `updateFeedback`.
- `handleRefine()` (`src/ui/components/AIPanel.tsx:368`) — calls `refineScript(currentScript, lastPrompt, loadedSamples, 2, onProgress)` (2 rounds, ~4 API calls); guarded by `isRefining`, a 10s `refineCooldown`, and the budget check.

## Data flow
**Calls in:** rendered by `Editor.tsx` (the AI panel inside the editor workspace). Parent supplies `currentScript`, `loadedSamples`, the controlled `target`, and the four result callbacks. `Chat.tsx` does **not** use this component — it calls the same `lib/aiGenerate.ts` functions directly for its conversational UI.

**Calls out:**
- [AI pipeline](../lib/ai-pipeline.md) — `generateCode`, `generateEnsemble`, `refineScript`, `generateSampleSpec` from `lib/aiGenerate.ts`.
- [AI providers](../lib/ai-providers.md) — `createProvider`, `getPreferredProvider`/`setPreferredProvider`, `getSessionCostCents`, `checkBudget` from `lib/aiProvider.ts`.
- `engine/spatial/TrajectoryGen.ts` — `generateTrajectoryFromPrompt(provider, prompt)` for the trajectory target.
- `lib/feedbackStore.ts` — `createFeedbackEntry`, `saveFeedback`, `updateFeedback` for RLHF.
- `theme/ThemeContext.tsx` — `useTheme()` for all colors.

Results flow **up** through `onGenerate` (and friends); the panel never imports the engine or editor.

## Invariants & gotchas
- **Apply-only-if-playable guard.** Generated/restored script code is only handed to `onGenerate` when it matches `/\b(loop|oneshot)\b/` (`src/ui/components/AIPanel.tsx:299`, `:182`). A response with no playable statement is kept in history but never written to the editor — so a "successful" generation can silently fail to update the viewport if the model omitted `loop`/`oneshot`.
- **History truncation on branch.** When the user generates after stepping back (`historyIndex >= 0`), the forward entries are discarded (`prev.slice(0, historyIndex + 1)`), then `historyIndex` resets to `-1` (= current/new). Standard undo-stack behavior; forward redo is lost on a new generation.
- **ASR always needs the OpenAI key**, even when the selected provider is Claude or Gemini — Whisper is OpenAI-only (`src/ui/components/AIPanel.tsx:50`). Recordings shorter than 300ms are silently dropped.
- **Budget guard is session-scoped.** `checkBudget()` blocks `sendPrompt` and `handleRefine` once `getSessionCostCents()` exceeds the budget; the only reset is a page refresh (`budgetExceeded` state + the status message say so).
- **Conversation context is lightweight.** Only the last 3 `script`-target prompts are sent as history, and assistant turns are stubbed as `[generated N line script]` — full generated code is intentionally not replayed to avoid token bloat (`src/ui/components/AIPanel.tsx:266`). The actual current script is sent separately via the pipeline's enriched prompt.
- **Theme tokens only.** All colors come from `useTheme()`; per lessons.md #8 (hardcoded hex breaks dark mode), do not reintroduce literal palette hexes here — note the one remaining `#f0ede6` ensemble-hint background at `src/ui/components/AIPanel.tsx:548` is a known light-only literal.
- The refine button has a hard **10-second cooldown** after each run (`setTimeout(..., 10_000)` at `src/ui/components/AIPanel.tsx:421`) to prevent rapid re-clicks burning credits.

## Change checklist
- Adding a new AI provider? Update the provider `<select>` options (`src/ui/components/AIPanel.tsx:493`) — and follow the full "Adding a new AI provider" steps in CLAUDE.md (provider class, `createProvider` order, `userSettings`, Dashboard input).
- Adding a new generation target? Extend `AITarget` (`:25`), add a branch in `sendPrompt` (`:213`), add a target button (`:454`), and wire a result callback into `AIPanelProps`.
- Changing pipeline signatures (`generateCode`/`generateEnsemble`/`refineScript`/`generateSampleSpec`)? Update both call sites here and the [AI pipeline](../lib/ai-pipeline.md) page; `Chat.tsx` calls the same functions and must stay in sync.
- Touching feedback shape? Keep `createFeedbackEntry`/`updateFeedback` usage (rating, `wasUndone`) consistent with `lib/feedbackStore.ts`.

## Sources
- `src/ui/components/AIPanel.tsx`
