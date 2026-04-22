# AI Tier 0 Implementation Plan

Three changes to make Satie's AI design coherent soundscapes instead of scattering objects. Grounded in the current `src/lib/aiGenerate.ts` pipeline (which already has `scoreScript`, `generateEnsemble`, `refineScript`, and `feedbackStore.getTopExamples`).

- **A — Scene Graph Intermediate**: LLM reasons about scene ecology before emitting DSL
- **B — Archetype Exemplar Retrieval**: curated gold examples injected as few-shots
- **C — Audio-Grounded Verifier**: render candidates, score with CLAP + Audiobox Aesthetics, rerank

---

## Phase 0 — Prep (½ day, do once before A/B/C)

Make the pipeline extensible without rewriting the happy path.

1. In `src/lib/aiGenerate.ts`, split `generateCode()` into explicit stages so each Tier 0 addition is a drop-in:
   ```
   plan()  →  retrieve()  →  generate()  →  verify()  →  audit()
   ```
   Each returns a typed artifact; `generate()` stays the current LLM call. This lets A/B/C plug in without mutating the orchestration.
2. Add a `GenerationTrace` type that threads through the stages (scene graph, retrieved exemplars, score, audio score, repair attempts). Log it to `feedbackStore` alongside the existing entry — this is the data you'll need in 3 months to tune anything.
3. Feature-flag each stage via `localStorage` (`satie-ai-scenegraph`, `satie-ai-retrieval`, `satie-ai-audit`) so you can A/B test against production without a branch.

**Files touched:** `src/lib/aiGenerate.ts`, `src/lib/feedbackStore.ts` (add trace field).

---

## Phase A — Scene Graph Intermediate (1–2 weeks)

**Goal:** LLM reasons ecologically about *what belongs in a scene* before committing to DSL. Single biggest-ROI change.

### Architecture

```
User prompt + current script
        │
        ▼
┌─────────────────┐        ┌─────────────────┐
│ Plan stage (NEW)│──JSON─▶│ Compile stage   │──DSL──▶ verify/repair
│  LLM → graph    │        │  deterministic  │
└─────────────────┘        └─────────────────┘
```

### Scene Graph schema (strawman)

```ts
interface SceneGraph {
  archetype: string;          // "forest_dawn" | "urban_alley" | ...
  listener: { height: number; facing: "north"|"south"|...; movement: "static"|"walking" };
  sources: SceneSource[];
  relations: SceneRelation[]; // "stream_left_of_listener", "birds_above_canopy"
  global_dsp: { reverb_room: "small"|"medium"|"hall"|"outdoor"; ambient_filter?: string };
}
interface SceneSource {
  id: string;
  class: string;               // "bird_songbird" | "wind_leaves" | "footsteps_gravel"
  count: { min: number; max: number };
  distance_m: [number, number];
  elevation: "ground"|"mid"|"canopy"|"sky";
  azimuth_region: "front"|"left"|"right"|"back"|"diffuse";
  density: "sparse"|"medium"|"dense"|"continuous";
  behavior: "static"|"calling"|"passing"|"circling"|"wandering";
  dsp_profile: "distant_bright"|"close_dry"|"mid_low_airy"|...;
  sample_hint?: string;        // library name OR gen prompt
}
```

### Implementation steps

1. **New file:** `src/lib/sceneGraph.ts`
   - Export `SceneGraph`, `SceneSource`, `SceneRelation` types.
   - Export `compileSceneGraph(graph): string` — pure deterministic function that emits Satie DSL. No LLM call. This is the testable, boring heart of the system.
     - Each `SceneSource` → one `N * loop` or `oneshot` statement with count from `count.min-max`.
     - `distance_m + azimuth_region + elevation` → derives position using a fixed mapping table.
     - `behavior` → maps to `move` type (static → none, wandering → `fly`, circling → `orbit`, passing → `walk`, calling → none).
     - `density` → maps to `every` ranges (sparse → `every 4to10`, continuous → `loop` with no every).
     - `dsp_profile` → maps to a canned reverb/filter combo (lookup table, not LLM-generated).
     - `global_dsp.reverb_room` → wraps everything in `group ambience` with a group-level reverb.
   - Export `validateSceneGraph(graph)` — shape checks + enum checks + physical plausibility (distance > 0, no clashing azimuths when density is dense).

2. **New function in `aiGenerate.ts`:** `generateSceneGraph(prompt, currentScript, samples, history): Promise<SceneGraph>`
   - New system prompt (`SCENE_GRAPH_SYSTEM_PROMPT`) — replaces the DSL reference with **scene-design heuristics**:
     - "A forest at dawn has 3–6 bird sources (sparse, canopy, calling), 1 wind source (diffuse, continuous, ground-canopy), optional 1 stream (fixed direction, continuous, ground). Do NOT put all sources at the listener."
     - Archetype templates as 5–8 reference examples.
     - Rules like "sources closer than 2m should be few and purposeful; ambience lives at 8–30m."
   - Output is JSON only. Use `json_mode`/schema-constrained decoding where the provider supports it (OpenAI/Gemini); fallback to regex extraction for Claude.
   - Uses fast model by default.

3. **Wire into `generateCode()`:**
   ```ts
   if (flags.sceneGraph) {
     const graph = await generateSceneGraph(...);
     const scaffold = compileSceneGraph(graph);           // deterministic DSL
     return verifyAndRepair(scaffold);                     // no second LLM call
   } else {
     return currentPipeline();
   }
   ```
   **Intentional choice:** no second LLM call for DSL emission. The compiler is pure, testable, deterministic, free. The LLM reasons about *scene*, not *syntax*.

4. **Edit flow:** for existing-script edits, skip the plan stage on cosmetic tweaks (detected via `isComplexPrompt`). Only re-plan when the user asks for structural/scene changes. Preserve the current behavior of "never rewrite gen prompts."

### Success criteria

- Clean-slate generations for 6 archetype prompts (forest_dawn, urban_night, ocean_coast, cathedral_interior, rainforest, cafe) produce scripts with:
  - Source counts matching ecological norms (forest_dawn → 3–6 birds, not 1 or 20)
  - Spatial spread > 0.4 on `scoreScript.spatialCoverage`
  - At least one ambient layer + one foreground layer (detectable via `group` presence)
- A/B vs. current pipeline on 20 prompts: blind evaluator prefers scene-graph output ≥ 60% of the time.

### Risk / mitigation

- **Risk:** scene graph adds ~1s latency (second LLM call). **Mitigation:** use fast model, prompt-cache the system prompt, skip for edits.
- **Risk:** deterministic compiler becomes rigid. **Mitigation:** allow optional `raw_satie` override field in each `SceneSource` so the LLM can escape the template for unusual requests.

---

## Phase B — Archetype Exemplar Retrieval (1 week)

**Goal:** Make the generator learn from known-good examples, not just static prompt rules. Compounds as the corpus grows.

### Architecture

```
User prompt ──▶ embed ──▶ retrieve top-K exemplars ──▶ inject as few-shots
                                │
                                ▼
                    ┌──────────────────────┐
                    │ Archetype corpus     │
                    │  - hand-curated ~40  │
                    │  - + top-liked user  │
                    │    sketches          │
                    └──────────────────────┘
```

### Implementation steps

1. **Curate the seed corpus** (the highest-leverage non-code work).
   - Hand-author 40 `.satie` scripts covering the archetype axes:
     - Environment: forest, ocean, urban, rural, cathedral, cave, cafe, subway, rainstorm, desert, rainforest, tundra
     - Time: dawn, day, dusk, night
     - Mood: calm, tense, playful, mournful, ecstatic
     - Aim for ~3 scripts per environment across 2–3 time/mood combos.
   - Each script is a *gold example* — you wrote it, you like it. This is the single piece of work that can't be shortcutted.
   - Store as `src/ui/assets/archetypes/<name>.satie` + a sibling `<name>.meta.json` with `{ archetype, description, tags, notes }`.

2. **Embedding store:** `src/lib/archetypeStore.ts`
   - On app boot, embed each exemplar's description + tags using the current AI provider's embedding endpoint (or OpenAI `text-embedding-3-small` — cheapest option, ~$0.02/1M tokens).
   - Cache embeddings in IndexedDB so re-embedding only happens when corpus changes.
   - Export `retrieveExemplars(prompt, k=3): Promise<Exemplar[]>` — cosine similarity over the corpus.

3. **Wire into `buildSystemPrompt()`:**
   - When `flags.retrieval` is on, append top-3 exemplars to the system prompt under an `═══ REFERENCE EXAMPLES ═══` section.
   - Budget: ~2000 tokens total for exemplars. Truncate scripts >600 tokens.
   - Cache-friendly ordering: static DSL reference → exemplars (this part varies less than the library listing) → library listing (varies per call).

4. **Feedback-weighted retrieval (minor add):**
   - Extend `getTopExamples()` in `feedbackStore` to also return by-archetype.
   - At retrieve time, mix: top-2 from hand-curated + top-1 from user-liked (score > 0.7) filtered by same archetype.
   - This is the "RLHF without training" piece — liked sketches automatically become few-shots.

5. **Integration with Phase A:** the scene graph prompt *also* benefits from retrieval. Retrieve before `generateSceneGraph()` and inject as "example scene graphs" (you'll need to back-derive scene graphs from the 40 curated scripts — good dogfooding exercise for the compiler).

### Success criteria

- Top-3 retrieval accuracy on 20 held-out prompts ≥ 70% (human-judged "relevant archetype").
- Generation quality on same-archetype follow-ups improves subjectively.
- Zero training involved; corpus grows organically from user likes.

### Risk / mitigation

- **Risk:** embeddings cost a per-prompt API call. **Mitigation:** cache user prompt embeddings for 5 min (most interaction is iterative on the same prompt).
- **Risk:** curated corpus becomes stale. **Mitigation:** versioned in git, reviewed quarterly; user-liked sketches handle freshness automatically.

---

## Phase C — Audio-Grounded Verifier (2 weeks)

**Goal:** Move from "does the code parse and look well-structured?" (`scoreScript`) to "does the rendered audio match the intent?" This is the closed-loop piece.

### Architecture

```
Verified script ──▶ render 8s offline ──▶ [Audiobox CE/PQ] + [CLAP vs prompt] ──▶ audit score
                                                                                   │
                                                         reject & regenerate OR accept
```

### Implementation steps

1. **Render-to-buffer helper:** `src/lib/audioAudit.ts`
   - Wrap `renderOffline()` from `src/engine/export/OfflineRenderer.ts` to render 8 seconds, stereo, at 16kHz (that's what CLAP/Audiobox want — cuts render time ~3×).
   - Reuse the editor's `decodedAudioBuffers` map so we don't re-decode samples.
   - Downsample to 16kHz mono after render (both CLAP and Audiobox are mono).

2. **Audiobox Aesthetics reranker:**
   - Meta released weights under research license at [facebook/audiobox-aesthetics](https://github.com/facebookresearch/audiobox-aesthetics). Python-only; we need it callable from the browser OR via a thin proxy.
   - **Decision point — run in browser vs. server:**
     - *Browser path:* port the model to ONNX Runtime Web or Transformers.js. ~300MB model (WavLM encoder). First load is painful, subsequent loads are cached. Fully client-side, aligned with Satie's privacy posture. **Recommended for Tier 0-C.**
     - *Server path:* small Python service (FastAPI + PyTorch) behind Supabase Functions. Faster inference, simpler port, but introduces backend ops.
   - Start with ONNX export of the CE (Content Enjoyment) head only — the other axes matter less for "is this a good soundscape." If that hits a blocker, fall back to a tiny Supabase Edge Function.
   - Output: CE score 1–10.

3. **CLAP prompt-coherence score:**
   - Use LAION's `laion/larger_clap_music_and_speech` or the smaller `laion/clap-htsat-unfused` — also available as ONNX.
   - Embed the user's original prompt (text side) + the rendered audio (audio side). Cosine similarity.
   - Output: coherence score 0–1.

4. **Audit stage in `generateCode()`:**
   ```ts
   interface AuditScore {
     audiobox_ce: number;      // 1–10
     clap_coherence: number;   // 0–1
     accepted: boolean;
     reason: string;
   }

   async function auditAudio(code, prompt): Promise<AuditScore>
   ```
   - Run in parallel with returning the script to the user (non-blocking) when flag is off for audit-gated mode.
   - When in **reranker mode** (default once this ships): run audit on all `generateEnsemble` candidates *after* rendering, pick the winner by `0.6 * (audiobox_ce/10) + 0.4 * clap_coherence`. Replaces or complements the current `scoreScript.total`.
   - When in **gate mode** (opt-in): reject if `clap_coherence < 0.2` (clearly off-prompt) and re-generate up to 1 time.

5. **UX:**
   - In `AIPanel` show a small badge ("aesthetic 7.2/10 · match 0.71") below generated scripts.
   - Log audit scores into `feedbackStore` — they become the signal for Tier 2 KTO training later.

### Success criteria

- Rerank on `generateEnsemble` with 3 candidates correlates ≥ 0.6 with your own blind preference on 30 prompts.
- Audit adds < 3s latency per candidate (8s render at 16kHz should run in <1s on a laptop; model inference <500ms once loaded).
- Audiobox + CLAP models load once per session, persist across generations.

### Risk / mitigation

- **Risk:** 300MB model download is a nonstarter for the web app. **Mitigation:** defer load until user opts in to "best quality" mode; or put it behind a Supabase Edge Function called only when user explicitly requests best-of-N.
- **Risk:** ONNX port of WavLM is non-trivial. **Mitigation:** start with the simpler CLAP-only path; add Audiobox once CLAP is working and shipping.
- **Risk:** Aesthetic and coherence scores disagree. **Mitigation:** log both, weight them, revisit weights after 100 user sessions.

---

## Sequence & gating

```
Week 1      Phase 0 (split pipeline + tracing)
Week 2–3    Phase A (scene graph)                    ← ship behind flag, dogfood
Week 4      Phase B start: curate 40 archetypes      ← boring but critical
Week 5      Phase B wire-up (embedding + retrieval)
Week 6      Tier A+B flag on by default              ← eval vs. current
Week 7–8    Phase C (audio audit) — CLAP first, Audiobox second
Week 9      Tier 0 all-on, default
```

**Ship gate for each phase:** behind flag → internal dogfood 1 week → A/B on 20 prompts → flip default if win-rate ≥ 55%.

---

## What this plan explicitly does NOT do

- No training. Not KTO, not DPO, not fine-tuning. Those are Tier 2 — only after this plan is shipped and you have real telemetry.
- No custom model. No layout diffusion. No Satie-transformer. Those are Tier 3.
- No rewrite of `generateEnsemble` or `refineScript` — they stay; Phase C's audit integrates with them, doesn't replace them.
- No new engine code. Everything lives in `src/lib/` except the small render-at-16kHz helper which wraps existing `OfflineRenderer`.

---

## Open decisions before writing code

1. **Scene graph: LLM-emit-and-deterministic-compile (recommended) vs. two LLM calls (more flexible, costlier).** Strong preference for the deterministic compiler — it's the only way the scene graph stays truthful.
2. **Audiobox: browser ONNX (hard but pure client) vs. Supabase Edge Function (easy but backend).** Default to CLAP-browser-only first; decide on Audiobox after CLAP ships.
3. **Archetype corpus: solo curation vs. pair-writing?** These 40 scripts are the single piece of content that determines quality.
4. **Feature-flag strategy: localStorage toggles (default) vs. Supabase user settings (shareable A/B).** For v1, localStorage.
