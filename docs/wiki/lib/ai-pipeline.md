---
title: AI generation pipeline — aiGenerate.ts
subsystem: lib
sources:
  - src/lib/aiGenerate.ts
synced_sha: ccafe3d971d6
synced: 2026-06-03
related: [ai-providers.md, ../ui/ai-panel.md, ../ui/chat.md, ../api/endpoints.md]
---

## Purpose

Pure (no-React) pipeline that turns a natural-language prompt into verified Satie DSL code: build prompt → call AI → clean → verify/repair.

## Why it exists / responsibilities

This module was extracted from `AIPanel.tsx` so both [AIPanel](../ui/ai-panel.md) and [Chat](../ui/chat.md) can share one generation path. It owns:

- The compositional system prompt (the Satie DSL reference baked into every call), including the **spatial-composition knowledge**: the sound-source archetype taxonomy (enveloping/directional bed, landmark, mobile agent, transient accent) and the `place`/`move` semantic vocabulary that make a scene's layout coherent.
- A **scene-plan stage** (`generateScenePlan`): for fresh, complex prompts, the model first reasons about the spatial *layout* — which elements exist and where each sits/moves — and that plan is injected into the code-gen call so related elements share a bearing (the fix for "make a beach" putting the ocean in the air).
- Prompt assembly: static DSL reference + dynamic audio-library listing + per-request enriched user message (optional scene plan, current script, sample availability).
- Output sanitization (strip markdown fences and surrounding prose).
- Compile verification via the real parser, with fast-model repair retries.
- Side pipelines: sample-spec JSON generation, heuristic script scoring, ensemble generation, and iterative refinement.

It delegates all model selection and HTTP to [aiProvider](./ai-providers.md) (`createProvider`, `createFastProvider`, `isComplexPrompt`, `getSessionCostCents`).

## Mental model

```
generateCode(prompt, currentScript, samples, history)
  │
  ├─ isComplexPrompt? ── yes → createProvider()      (full model)
  │                      no  → createFastProvider()  (cheap model)
  ├─ checkLibrary()         → which sounds are loaded vs. must be gen'd
  ├─ generateScenePlan()    → (fresh + complex only) soundstage layout, injected as a plan block
  ├─ buildSystemPrompt()    = STATIC_SYSTEM_PROMPT + audio library listing
  ├─ buildEnrichedPrompt()  = [scene plan] + samples + CURRENT SCRIPT + REQUEST
  ├─ callAI(provider, ...)  → raw model text
  ├─ cleanGeneratedCode()   → strip fences/prose
  └─ verifyAndRepair()      → tryParse; on failure, fast-model repair (≤2 attempts)
        → { code, error, costCents }
```

The system prompt is deliberately split: `STATIC_SYSTEM_PROMPT` is byte-identical across calls (so Anthropic prompt caching can discount it), and `buildSystemPrompt` appends only the per-call audio-library section.

## Key types & functions

Public surface (all exported unless noted):

- `cleanGeneratedCode(raw): string` — src/lib/aiGenerate.ts:19. Removes ```` ``` ```` fenced blocks, strips leading non-code prose (keeps from the first line matching `loop|oneshot|group|N *|#|comment`), strips trailing prose.
- `LibraryCheckResult` (interface) — src/lib/aiGenerate.ts:76. `{ availableSamples, missingSamples }`.
- `checkLibrary(prompt, loadedSamples): LibraryCheckResult` — src/lib/aiGenerate.ts:99. Matches a hardcoded keyword list (`extractSoundKeywords`, src/lib/aiGenerate.ts:81) against loaded sample names.
- `callAI(provider, systemPrompt, messages, maxTokens=2048, temperature=0.7): Promise<string>` — src/lib/aiGenerate.ts:122. Thin wrapper over `provider.call`.
- `STATIC_SYSTEM_PROMPT` (const) — src/lib/aiGenerate.ts:144. The cacheable DSL reference: how-to-think, iterative refinement, compositional patterns, **spatial composition** (archetype taxonomy + `place`/`move` vocabulary + coherence rules + a worked "beach" layout), syntax reference, common mistakes, critical rules.
- `SCENE_PLAN_SYSTEM_PROMPT` (const) — the planner's system prompt: teaches the archetypes + placement vocabulary and demands a JSON `{scene, elements[]}` layout only.
- `ScenePlan` / `ScenePlanElement` (interfaces) — the parsed layout: a one-line `scene` and `elements` each with `{name, archetype, place, move}` (place/move are DSL-ready strings).
- `generateScenePlan(userPrompt, provider?): Promise<ScenePlan | null>` — calls the model for a layout, defensively parses the JSON, returns `null` on any failure (planning is best-effort — generation falls back to direct).
- `formatScenePlanForPrompt(plan): string` — renders the plan as a `SOUNDSTAGE PLAN` block (per-element `place …  move …`) that the code-gen step must honour.
- `buildSystemPrompt(loadedSamples, libraryResult): string` — src/lib/aiGenerate.ts:418. `STATIC_SYSTEM_PROMPT` + the available-audio-files listing (or a "use gen keyword" note when empty).
- `SAMPLE_GEN_SYSTEM_PROMPT` (const) — src/lib/aiGenerate.ts:434. System prompt for `generateSampleSpec`; demands a JSON `{name, prompt}` only.
- `buildEnrichedPrompt(userPrompt, currentScript, libraryResult): string` — src/lib/aiGenerate.ts:458. Assembles the user message: available/missing samples, then either `CURRENT SCRIPT:` + `REQUEST:` (when a non-empty, non-`# satie` script exists) or just `REQUEST:`.
- `REPAIR_SYSTEM_PROMPT` (const, module-private) — src/lib/aiGenerate.ts:493. Syntax-only repair prompt for the fast model.
- `verifyAndRepair(code, maxAttempts=2): Promise<{success, code, error}>` — src/lib/aiGenerate.ts:522. Loops `tryParse`; on parse failure (and not the last attempt) calls the fast provider with parser errors, re-cleans, retries.
- `generateCode(userPrompt, currentScript, loadedSamples, conversationHistory): Promise<{code, error, costCents}>` — src/lib/aiGenerate.ts:562. The main orchestration entry point.
- `generateSampleSpec(userPrompt): Promise<{name, prompt}>` — src/lib/aiGenerate.ts:604. Fast model → JSON `{name, prompt}`; sanitizes `name` to `[a-z0-9_]`; falls back to first two words of the prompt on JSON parse failure.
- `ScriptScore` (interface) — src/lib/aiGenerate.ts:633, and `scoreScript(code): ScriptScore` — src/lib/aiGenerate.ts:654. Heuristic 0–1 composite (parse validity, voice count, spatial coverage, DSP richness, interpolation/ranges/groups, movement, trajectory bonus). Used by the ensemble/refinement features below.
- `EnsembleCandidate` / `EnsembleResult` (interfaces) — src/lib/aiGenerate.ts:773–783, and `generateEnsemble(...)` — src/lib/aiGenerate.ts:792. Generates N candidates in parallel at varied temperatures, scores each, returns them ranked (valid parses first, then by `score.total`).
- `RefinementProgress` (interface) — src/lib/aiGenerate.ts:847, and `refineScript(...)` — src/lib/aiGenerate.ts:860. Multi-round "keep only if score improved" refinement loop with an optional `onProgress` callback.

## Data flow

In: called by [AIPanel](../ui/ai-panel.md) and [Chat](../ui/chat.md), which pass the user prompt, the current editor script, the list of loaded sample names, and the recent conversation history. Chat passes the last ~6 message pairs so iterative requests ("add more reverb") resolve against `CURRENT SCRIPT:`.

Out:
- [aiProvider](./ai-providers.md) — `createProvider`/`createFastProvider` choose the model; `isComplexPrompt` gates which one; `getSessionCostCents` brackets the call to report `costCents`.
- `tryParse` from the engine [parser](../engine/parser.md) — the verification oracle inside `verifyAndRepair` and `scoreScript`; no external API call.
- `WanderType` / `Statement` from the engine — read by `scoreScript` to inspect parsed voices.

`generateCode` returns `{ code, error, costCents }`; a non-null `error` means parse-repair exhausted its attempts and the code still does not parse (callers may surface it but typically still load the best-effort `code`).

## Invariants & gotchas

- **Prompt-cache prefix is load-bearing.** Keep `STATIC_SYSTEM_PROMPT` byte-identical across calls. Per-request content belongs in `buildSystemPrompt`'s appended section or in `buildEnrichedPrompt`, never spliced into the static block — otherwise the cache discount is lost.
- **Visual-property rule is in the prompt, not the parser.** Moving voices (any motion archetype or walk/fly/spiral/orbit/lorenz/gen) get `visual trail`; still voices (`move static` or `place` only) get `visual sphere`. This is an instruction to the model, so generated scripts can occasionally violate it.
- **The scene plan runs only for fresh, complex prompts** (`complex && !hasExistingScript`). Edits to an existing script already carry their `place`/`move` directives, so re-planning is skipped to save a model round-trip. Planning failures are swallowed (`generateScenePlan` returns `null`) and generation proceeds without a plan block.
- **Spatial coherence is a prompt/plan-level guarantee, not enforced by the parser.** The archetype taxonomy and "linked elements share a bearing" rule live in `STATIC_SYSTEM_PROMPT` + `SCENE_PLAN_SYSTEM_PROMPT`; the deterministic word→coordinate mapping that backs them lives in the engine ([spatial-movement](../dsl/spatial-movement.md)).
- **Never rewrite gen prompts on edit.** The system and refinement prompts forbid changing existing `gen <text>` (src/lib/aiGenerate.ts:403, :889) because changed gen text triggers expensive ElevenLabs re-generation. This is a soft (prompt-level) guarantee.
- **`# satie` counts as empty.** `buildEnrichedPrompt` and `generateCode` treat a script that is blank or exactly `# satie` as "no current script", so a fresh editor generates rather than edits (src/lib/aiGenerate.ts:475, :569).
- **Repair uses the fast model at low temperature** (0.2) and re-runs `cleanGeneratedCode` on its output before re-parsing. A thrown provider error aborts repair and returns the original parser error, not a crash.
- **`cleanGeneratedCode` is heuristic.** The leading/trailing prose strippers key off regexes for Satie keywords and indentation; unusual valid output (e.g. a script that legitimately opens with a long un-indented comment line) could be over-trimmed.
- **RLHF feedback is collected but NOT injected** into prompts (src/lib/aiGenerate.ts:947). It lives in IndexedDB (`feedbackStore.ts`) for offline analysis; injecting it inflated per-call token cost for marginal benefit.
- **Sample-spec JSON is defensively parsed.** `generateSampleSpec` strips a leading ```` ```json ```` fence and falls back to a name derived from the prompt if `JSON.parse` throws.

## Change checklist

- Editing DSL syntax/rules the model must follow → update `STATIC_SYSTEM_PROMPT` (src/lib/aiGenerate.ts:144) and the mirror in `REPAIR_SYSTEM_PROMPT` (src/lib/aiGenerate.ts:493) so repair and generation agree.
- Adding a new parser property/keyword → reflect it in both system prompts above; otherwise the model never emits it and repair may strip it.
- Changing the spatial vocabulary (sectors/depths/archetypes) → update `STATIC_SYSTEM_PROMPT`, `SCENE_PLAN_SYSTEM_PROMPT`, and `REPAIR_SYSTEM_PROMPT` together, and keep them in sync with `Placement.ts` ([spatial-movement](../dsl/spatial-movement.md)).
- Changing the `{code, error, costCents}` return shape → update callers [AIPanel](../ui/ai-panel.md) and [Chat](../ui/chat.md).
- Changing model selection or cost accounting → coordinate with [aiProvider](./ai-providers.md) (`createProvider`/`createFastProvider`/`isComplexPrompt`/`getSessionCostCents`).
- Touching `scoreScript`'s read of parsed fields → keep in sync with `Statement` shape in the engine.
- Any edit to `src/lib/aiGenerate.ts` → update this page in the same commit (wiki commit gate).

## Sources

- src/lib/aiGenerate.ts
