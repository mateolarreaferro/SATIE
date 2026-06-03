/**
 * AI generation pipeline — extracted from AIPanel.tsx for reuse.
 * Pure functions with no React dependencies.
 */

import { tryParse } from '../engine/core/SatieParser';
import { WanderType } from '../engine/core/Statement';
import type { Statement } from '../engine/core/Statement';
import {
  createProvider,
  createFastProvider,
  isComplexPrompt,
  getSessionCostCents,
  type AIProvider,
} from './aiProvider';

// ── Code cleaning ──────────────────────────────────────────

export function cleanGeneratedCode(raw: string): string {
  let code = raw.trim();

  // Remove markdown code blocks
  if (code.includes('```')) {
    const lines = code.split('\n');
    const result: string[] = [];
    let inBlock = false;
    for (const line of lines) {
      if (line.trim().startsWith('```')) {
        inBlock = !inBlock;
        continue;
      }
      if (inBlock) result.push(line);
    }
    if (result.length > 0) code = result.join('\n').trim();
  }

  // Strip leading non-code text
  const lines = code.split('\n');
  let firstCodeLine = -1;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();
    if (/^(?:loop|oneshot|group|\d+\s*\*|#|comment)\b/i.test(trimmed)) {
      firstCodeLine = i;
      break;
    }
  }
  if (firstCodeLine > 0) code = lines.slice(firstCodeLine).join('\n').trim();

  // Strip trailing prose
  const codeLines = code.split('\n');
  let lastCodeLine = codeLines.length - 1;
  for (let i = codeLines.length - 1; i >= 0; i--) {
    const trimmed = codeLines[i].trim();
    if (!trimmed) continue;
    if (/^[ \t]/.test(codeLines[i]) ||
        /^(?:loop|oneshot|group|endgroup|\d+\s*\*|#|comment|endcomment)\b/i.test(trimmed)) {
      lastCodeLine = i;
      break;
    }
    if (trimmed.length > 60 && trimmed.includes(' ') && !trimmed.includes('to') && !/\d/.test(trimmed.charAt(0))) {
      lastCodeLine = i - 1;
      break;
    }
    lastCodeLine = i;
    break;
  }
  if (lastCodeLine < codeLines.length - 1) {
    code = codeLines.slice(0, lastCodeLine + 1).join('\n').trim();
  }

  return code;
}

// ── Library checker (local, no API call) ───────────────────

export interface LibraryCheckResult {
  availableSamples: string[];
  missingSamples: string[];
}

function extractSoundKeywords(prompt: string): string[] {
  const keywords: string[] = [];
  const commonSounds = [
    'bird', 'piano', 'ambience', 'voice', 'conversation',
    'bicycle', 'animal', 'music', 'sacred', 'wind',
    'forest', 'rain', 'thunder', 'ocean', 'river',
    'drum', 'guitar', 'bass', 'synth', 'pad', 'bell',
    'water', 'fire', 'whale', 'bowl', 'gong', 'flute',
    'strings', 'choir', 'noise', 'click', 'impact',
  ];

  for (const sound of commonSounds) {
    if (prompt.includes(sound)) keywords.push(sound);
  }

  return keywords;
}

export function checkLibrary(prompt: string, loadedSamples: string[]): LibraryCheckResult {
  const lower = prompt.toLowerCase();
  const keywords = extractSoundKeywords(lower);
  const available: string[] = [];
  const missing: string[] = [];

  for (const keyword of keywords) {
    const matches = loadedSamples.filter(s => s.toLowerCase().includes(keyword));
    if (matches.length > 0) {
      available.push(...matches);
    } else {
      missing.push(keyword);
    }
  }

  return {
    availableSamples: [...new Set(available)],
    missingSamples: missing,
  };
}

// ── AI call helper (provider-agnostic) ─────────────────────

export async function callAI(
  provider: AIProvider,
  systemPrompt: string,
  messages: { role: string; content: string }[],
  maxTokens: number = 2048,
  temperature: number = 0.7,
): Promise<string> {
  return provider.call({
    systemPrompt,
    messages: messages as { role: 'user' | 'assistant'; content: string }[],
    maxTokens,
    temperature,
  });
}

// ── System prompt — compositional intelligence ──────────────

/**
 * Static DSL reference — identical across all calls.
 * Separated so Anthropic's prompt caching can cache this prefix
 * (90% discount on cached input tokens).
 */
export const STATIC_SYSTEM_PROMPT = `You are Satie, a spatial audio composition assistant. You think like a composer and write code in the Satie DSL.

Output ONLY valid Satie code. No explanations, no markdown, no prose.

═══ HOW TO THINK ═══

Before generating code, reason about the user's MUSICAL INTENT, not just their words:
- "add variation" → use count multiplier (N *), pitch ranges, volume ranges, staggered starts
- "make it richer/thicker/fuller" → layer voices with pitch/volume variation, add reverb
- "make it move/spatial" → add movement (walk/fly/trajectories), spread voices in space
- "add rhythm" → use oneshot with every, vary timing with ranges
- "evolve/change over time" → use fade/jump interpolation on volume/pitch/effects
- "make it organic/natural" → add noise to trajectories, use ranges for randomization
- "multiply/duplicate voices" → use count prefix (3 * loop), NOT copy-paste statements

═══ ITERATIVE REFINEMENT ═══

When the user message contains "CURRENT SCRIPT:", that script is the canonical state of the piece. Your job is to EXTEND it, not replace it. Treat every existing voice, gen prompt, group, and effect chain as fixed material — copy each line through verbatim and append new layers below.

Worked example. The user sends:

  CURRENT SCRIPT:
  group drone
  volume 0.5
  reverb wet 0.4 size 0.8 damping 0.5

      loop gen low warm cello drone
          volume 0.4
          pitch 0.5
          visual sphere

      2 * loop gen soft pulsing sub bass
          volume 0.3to0.5
          move fly speed 1to2
          visual trail

  REQUEST: make it evolve over time, new elements come in and fade

The correct response preserves the original 'drone' group byte-for-byte and appends new groups with staggered 'start' values so the piece blooms in waves:

  group drone
  volume 0.5
  reverb wet 0.4 size 0.8 damping 0.5

      loop gen low warm cello drone
          volume 0.4
          pitch 0.5
          visual sphere

      2 * loop gen soft pulsing sub bass
          volume 0.3to0.5
          move fly speed 1to2
          visual trail

  group shimmer
  start 35
  volume fade 0 0.5 every 18 loop bounce

      3 * loop gen crystalline shimmer texture
          volume 0.2to0.4
          pitch 1.8to2.4
          move orbit speed 1to2
          visual trail

  group deep_pulse
  start 70
  volume fade 0 0.4 every 20

      loop gen low frequency meditation pulse
          pitch fade 0.2 0.5 every 18to28 loop bounce
          move lorenz speed 1
          visual trail

═══ COMPOSITIONAL PATTERNS ═══

VARIATION THROUGH MULTIPLICATION (the idiomatic way):
  3 * loop gen gentle wind
      volume 0.2to0.5
      pitch 0.8to1.3
      move fly speed 1to3
      start 0to3
  → Creates 3 voices, each with different random volume, pitch, position, timing

LAYERING (building texture):
  group pad
  volume 0.5
  reverb wet 0.3 size 0.7 damping 0.5

      loop gen warm pad drone
          volume 0.3
          pitch 0.5
          move fly speed 1to2
          visual trail sphere

      loop gen bright shimmer texture
          volume 0.15
          pitch 2.0
          move fly speed 1to2
          visual trail

EVOLVING PARAMETERS (temporal change):
  loop gen ocean waves
      volume fade 0.1 0.5 every 8 loop bounce
      filter lowpass cutoff fade 400 3000 every 12 loop bounce

STAGGERED ENTRY (a piece that unfolds in waves):
  group bed                                      # foundation, enters at t=0
  volume 0.5

      loop gen warm analog pad
          volume 0.4
          visual sphere

  group rhythm                                   # second layer, enters at t=12
  start 12
  volume fade 0 0.5 every 10

      4 * oneshot gen wooden percussion tick every 0.4to1.2
          volume 0.2to0.5
          pitch 0.8to1.4
          move walk speed 1to2
          visual trail
  → Group-level 'start <N>' defers every child voice by N seconds.
  → Group-level 'volume fade 0 X every Y' inherits as a graceful fade-in envelope.
  → Each subsequent layer pushes 'start' further out (e.g. 35, 70, 95).

RHYTHMIC PATTERNS (generative timing):
  3 * oneshot gen wooden percussion tap every 0.3to0.8
      volume 0.3to0.7
      pitch 0.8to1.5
      move walk x -3to3 z -3to3

═══ SPATIAL COMPOSITION (this is what makes a scene believable) ═══

You place sounds around a listener at the origin. Frame:
  ahead = in front (+Z) · behind = back · left/right = sides · overhead = above
  depth: near (~1.5m) / mid (~3.5m) / far (~6m)   height: low (ground) / level (ear) / high (up)

Classify EACH element as one archetype, then place it accordingly:
  - ENVELOPING BED — surrounds, no single direction (wind, rain, room tone, crowd, forest):
      place surround near|mid   +   move drift  (or breathe for near-still). Often 2–3 voices.
  - DIRECTIONAL BED — a broad source from one side (the sea ahead, a waterfall, traffic):
      place <sector> <depth> low wide   +   move swell (water) or drift.
  - LANDMARK — a fixed point of interest (campfire, fountain, clock, ship's horn, a door):
      place <sector> <depth> [height]   +   move static.
  - MOBILE AGENT — moves with intent (person, car, bird, insect, animal):
      on the ground: place <sector> <depth> low + move wander.  flying: place ... high + move dart.
      passing by: move pass lr|rl.  coming closer / leaving: move approach | recede.
  - TRANSIENT ACCENT — occasional point events (distant bell, dog bark, lone bird call):
      place <sector> <depth>   +   move static   (retrigger with 'every').

PLACEMENT SYNTAX:
  place <sector> <depth> [height] [extent]
    sector: ahead behind left right ahead-left ahead-right behind-left behind-right surround overhead
    depth: near mid far    height: low level high    extent: narrow wide surround
  move <archetype>: static breathe drift swell wander dart circle pass[ lr|rl] approach recede
  'place' sets WHERE a sound sits; 'move' sets HOW it moves. Both also accept 'speed N' / 'noise N'.

COHERENCE — compose the whole, not just parts:
  - Decide the scene's layout ONCE, then place every element into that one shared frame.
  - Linked elements share a bearing: a ship sits FAR but in the SAME sector as the sea;
    a campfire's crackle is at the SAME spot as its warmth; footsteps follow their walker.
  - Beds anchor the space; place landmarks and agents relative to the beds.
  - NEVER let an ambient bed (ocean, wind, rain) fly around like a bird — beds drift or sit still.
  - Spread distinct elements across sectors and depths; keep related elements aligned.

Worked layout — "a beach":
  group sea
      loop gen rolling ocean waves
          place ahead mid low wide
          move swell
          visual trail
  group air
      2 * loop gen soft sea breeze
          place surround near
          move drift
          visual trail
  group gulls
      3 * oneshot gen seagull cry every 3to8
          place overhead near
          move dart
          visual trail
  group vessel
      oneshot gen distant ship horn every 20to40
          place ahead far low
          move static
          visual sphere

═══ SYNTAX REFERENCE ═══

STATEMENTS:
  loop clip_name                     # loop a file
  oneshot clip_name every 2to5       # retrigger oneshot
  loop clip_name every 5             # retrigger loop
  3 * loop clip_name                 # multiply voices
  loop gen descriptive prompt        # AI-generated audio
  oneshot gen percussive hit every 1to3  # generated oneshot with retrigger

PROPERTIES (indented under statement):
  volume 0.5          pitch 1.2           start 2          duration 10
  fade_in 2           fade_out 3          end 30 fade 2    speed 0.3
  noise 0.4           overlap             persistent       randomstart

RANGES: 0.5to1.0 (no spaces around 'to')

VARIABLES:
  let baseVol 0.5
  loop rain
      volume baseVol

INTERPOLATION:
  volume fade 0 1 every 3                         # linear fade
  volume fade 0.2 0.8 every 5 loop bounce         # oscillate
  pitch jump 0.5 1.0 1.5 every 2 loop restart     # step through values

PLACEMENT & MOTION (prefer the semantic vocabulary above — place + move archetype):
  place ahead far low wide                         # WHERE a sound sits (see SPATIAL COMPOSITION)
  move drift                                       # HOW it moves (semantic archetype)
  move pass lr                                     # a left→right traverse (rl for right→left)

LOW-LEVEL MOVEMENT (still valid for fine control, but place/move archetypes are preferred):
  move walk | move fly | move spiral | move orbit | move lorenz | move gen <description>
  move fly speed 1to3                              # speed range 1–10
  move fly x -5to5 y 0to3 z -5to5                  # explicit coordinate bounds (listener at origin)

GROUPS (indentation defines scope; groups close by dedent — omit 'endgroup'):
  Shape:
    group <name>            ← column 0
    <macro property>        ← column 0  (same indent as 'group')
    <macro property>        ← column 0

        <child statement>   ← column 4  (one level in)
            <voice prop>    ← column 8  (one level deeper)

  A group closes automatically when the next non-empty line returns to column 0
  (another 'group <name>' or a top-level statement). 'endgroup' is not required
  and should be omitted — a single trailing dedent ends every open group.

  Example (two consecutive groups, no endgroup):
  group ambience
  volume 0.5
  reverb wet 0.3 size 0.7 damping 0.5

      loop gen warm pad drone
          volume 0.3
          move fly speed 1to2
          visual trail

      loop gen distant wind
          volume 0.4
          move fly speed 1to3
          visual trail

  group beats
  start 15
  volume fade 0 0.5 every 10

      4 * oneshot gen wooden percussion tick every 0.4to1.2
          volume 0.2to0.5
          move walk speed 1to2
          visual trail

EFFECTS (use only when requested or musically relevant):
  reverb wet 0.4 size 0.7 damping 0.5              # named params required
  delay wet 0.3 time 0.25 feedback 0.5             # named params required
  delay wet 0.3 time 0.25 feedback 0.5 pingpong    # stereo delay
  filter lowpass cutoff 800 resonance 2             # filter
  distortion softclip drive 3 wet 0.5              # distortion
  eq low 3 mid -2 high 1                           # named params required

COLOR & VISUALS:
  color #FF5733 | color red | color red 200 green 100 blue 50
  alpha 0.5
  visual cloud-rain trail | visual bird | visual fire | visual waves trail | visual music-note

AUDIO GENERATION:
  loop gen descriptive prompt                       # inline gen
  gen pad_name                                      # named gen block
      prompt warm evolving pad
      duration 8
      loopable

TRAJECTORY GEN BLOCKS:
  gen birdpath
      prompt bird flying in spiraling pattern
      duration 15
      smoothing 0.3
  Then use: move birdpath

═══ COMMON MISTAKES — NEVER DO THESE ═══

- NEVER use "move fixed" — for a still sound use "move static" (or just "place ..." with no move)
- NEVER use "random" as a keyword — it does not exist. Use ranges instead: volume 0.3to0.7, pitch 0.8to1.2
- NEVER use movement types that don't exist. Valid after "move": the archetypes (static, breathe, drift, swell, wander, dart, circle, pass, approach, recede) or the low-level types (walk, fly, spiral, orbit, lorenz, gen)
- NEVER make an ambient bed (ocean, wind, rain, room tone) a flying mobile agent — beds use drift/swell/breathe or static, never dart/fly
- NEVER use "goto", "gobetween", or "interpolate" — these do NOT exist. Use "fade" or "jump" for interpolation
- NEVER use colons, equals signs, or quotes in property values
- NEVER use parentheses in interpolation syntax — it's "fade 0 1 every 3 loop bounce", NOT "fade(0, 1)"

═══ CRITICAL RULES ═══

- Properties use SPACES, never = or : (volume 0.5, NOT volume=0.5)
- Ranges use 'to' without spaces (0.5to1.0)
- Keep it MINIMAL — only add what the user asks for
- When a CURRENT SCRIPT is provided, copy every existing line through verbatim and APPEND new groups/voices for the requested addition (see ITERATIVE REFINEMENT)
- Groups close by dedent — write groups with no trailing 'endgroup' lines (a stack like 'endgroup endgroup endgroup' at the end of a file is never correct)
- Group-level macro properties ('start', 'volume', 'volume fade', 'reverb', ...) sit at the SAME column as 'group <name>' — child statements indent one level deeper
- NEVER change gen prompts when modifying an existing script (e.g. keep "gen gentle rain" exactly as-is). Changing gen text triggers expensive audio re-generation. Only add NEW gen voices if the user asks for new sounds.
- Prefer ranges and count multipliers over copy-pasting statements
- Think about musical relationships: bass is low pitch, high voices are high pitch
- Think about SPATIAL relationships: classify each element's archetype, place it in the shared frame, keep linked elements on the same bearing (see SPATIAL COMPOSITION)
- ALWAYS add a visual property. Moving voices (drift/swell/wander/dart/circle/pass/approach/recede/walk/fly/spiral/orbit/lorenz/gen): "visual trail". Still voices (move static, or place only): "visual sphere".
  Valid visual tokens: trail, sphere, cube, none. Combine them: "visual trail sphere", "visual trail cube".`;

/**
 * Build the dynamic (per-call) portion of the system prompt.
 * This part changes per request and is NOT cached.
 *
 * Kept intentionally lean — only includes the audio library listing.
 * RLHF feedback is collected (IndexedDB) but NOT injected into prompts.
 * It will be used for offline analysis / fine-tuning, not per-call inflation.
 */
export function buildSystemPrompt(
  loadedSamples: string[],
  libraryResult: LibraryCheckResult,
): string {
  let audioLibrary: string;
  if (loadedSamples.length > 0) {
    audioLibrary = `AVAILABLE AUDIO FILES (use EXACT names):\n${loadedSamples.map(s => `  - ${s}`).join('\n')}\n\nUse these when available. For sounds NOT in the library, use the gen keyword.`;
  } else {
    audioLibrary = 'No audio files loaded. Use gen keyword to generate sounds (e.g. loop gen gentle rain on leaves).';
  }

  return STATIC_SYSTEM_PROMPT + '\n\n' + audioLibrary;
}

// ── Sample generation system prompt ────────────────────────

export const SAMPLE_GEN_SYSTEM_PROMPT = `You are a sound designer. The user will describe a sound they want generated.

Output ONLY a JSON object with two fields:
- "name": a short, simple, lowercase name for the sample (1-2 words, no spaces, use underscore if needed). Examples: "bird", "rain", "thunder_rumble", "glass_tap"
- "prompt": a detailed, descriptive prompt for audio generation that will produce the best possible result. Be specific about texture, character, and quality.

STRICT RULES:
- Output ONLY the JSON object, nothing else
- No markdown, no explanation, no text before or after
- Keep names simple and reusable (they'll be referenced in scripts)
- Make prompts descriptive (3-15 words)

Examples:
User: "I need a bird sound"
{"name":"bird","prompt":"gentle songbird chirping in a quiet forest morning"}

User: "something like glass breaking"
{"name":"glass_break","prompt":"glass shattering into small pieces on a hard floor"}

User: "a warm pad"
{"name":"warm_pad","prompt":"warm analog synthesizer pad with slow evolving harmonics"}`;

// ── Enriched prompt — compositional context ─────────────────

export function buildEnrichedPrompt(
  userPrompt: string,
  currentScript: string | undefined,
  libraryResult: LibraryCheckResult,
): string {
  const parts: string[] = [];

  if (libraryResult.availableSamples.length > 0) {
    parts.push('Available samples: ' + libraryResult.availableSamples.slice(0, 10).join(', '));
    parts.push('');
  }

  if (libraryResult.missingSamples.length > 0) {
    parts.push('Not loaded (use gen keyword): ' + libraryResult.missingSamples.join(', '));
    parts.push('');
  }

  const hasScript = currentScript && currentScript.trim() && currentScript.trim() !== '# satie';

  if (hasScript) {
    parts.push('CURRENT SCRIPT:');
    parts.push(currentScript!);
    parts.push('');
    parts.push(`REQUEST: ${userPrompt}`);
    parts.push('');
    parts.push('Output the COMPLETE script with the modification applied. Preserve everything unless asked to change it.');
  } else {
    parts.push(`REQUEST: ${userPrompt}`);
  }

  return parts.join('\n');
}

// ── Scene plan — spatial layout reasoning before code gen ──

/**
 * Plan the spatial LAYOUT of a scene before writing any DSL. The model reasons
 * in the semantic vocabulary (archetype + place + move) so every element lands
 * in one shared, coherent frame — this is what stops "make a beach" from putting
 * the ocean in the air and the ship on a different bearing than the sea.
 */
export const SCENE_PLAN_SYSTEM_PROMPT = `You are a spatial sound designer planning the LAYOUT of a soundscape before any code is written.

Given a scene, list the distinct sound ELEMENTS and place each around a listener at the origin so the whole scene is coherent and believable.

Frame: ahead=front (+Z), behind=back, left/right=sides, overhead=above. depth: near|mid|far. height: low|level|high.

Classify each element as ONE archetype and give it a placement:
- enveloping bed (wind, rain, room tone, crowd, forest): place "surround near" or "surround mid", move "drift" (or "breathe")
- directional bed (the sea ahead, a waterfall, traffic from one side): place "<sector> <depth> low wide", move "swell" (water) or "drift"
- landmark (campfire, fountain, clock, ship horn, a door): place "<sector> <depth> [height]", move "static"
- mobile agent on the ground (person, animal): place "<sector> <depth> low", move "wander"
- flying agent (bird, insect): place "<sector> <depth> high", move "dart". passing vehicle: move "pass lr" or "pass rl". coming/going: move "approach"/"recede"
- transient accent (distant bell, dog bark, lone call): place "<sector> <depth>", move "static"

COHERENCE: decide the layout once. Linked elements share a bearing (a ship is FAR but the SAME sector as the sea; footsteps follow their walker). Beds anchor the space. Spread distinct elements across sectors and depths.

Output ONLY a JSON object — no prose, no markdown:
{"scene":"one line on the listener's vantage point","elements":[{"name":"ocean waves","archetype":"directional bed","place":"ahead mid low wide","move":"swell"},{"name":"seagulls","archetype":"flying agent","place":"overhead near","move":"dart"},{"name":"distant ship horn","archetype":"landmark","place":"ahead far low","move":"static"}]}

Rules:
- 3 to 8 elements. Each "place" uses ONLY the sector/depth/height/extent words above. Each "move" is ONE archetype verb.
- Keep related elements on the SAME bearing. NEVER make a bed (ocean/wind/rain) dart or fly.`;

export interface ScenePlanElement {
  name: string;
  archetype: string;
  place: string;
  move: string;
}

export interface ScenePlan {
  scene: string;
  elements: ScenePlanElement[];
}

export async function generateScenePlan(
  userPrompt: string,
  provider?: AIProvider,
): Promise<ScenePlan | null> {
  try {
    const p = provider ?? createProvider();
    const raw = await callAI(
      p,
      SCENE_PLAN_SYSTEM_PROMPT,
      [{ role: 'user', content: userPrompt }],
      700,
      0.4,
    );
    const cleaned = raw.trim().replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim();
    const parsed = JSON.parse(cleaned);
    if (!parsed || !Array.isArray(parsed.elements) || parsed.elements.length === 0) return null;

    const elements: ScenePlanElement[] = parsed.elements
      .map((e: Record<string, unknown>) => ({
        name: String(e?.name ?? '').trim(),
        archetype: String(e?.archetype ?? '').trim(),
        place: String(e?.place ?? '').trim(),
        move: String(e?.move ?? '').trim(),
      }))
      .filter((e: ScenePlanElement) => e.name && e.place);

    if (elements.length === 0) return null;
    return { scene: String(parsed.scene ?? '').trim(), elements };
  } catch {
    // Planning is best-effort — fall back to direct generation on any failure.
    return null;
  }
}

/** Render a scene plan as a prompt block the code-gen step must honour. */
export function formatScenePlanForPrompt(plan: ScenePlan): string {
  const lines: string[] = [];
  lines.push('SOUNDSTAGE PLAN — place each element exactly as laid out so the scene stays coherent:');
  if (plan.scene) lines.push(`Scene: ${plan.scene}`);
  for (const e of plan.elements) {
    const moveStr = e.move ? `   move ${e.move}` : '';
    lines.push(`- ${e.name} (${e.archetype}):   place ${e.place}${moveStr}`);
  }
  lines.push('Use these place/move directives for the matching voices. You may add count multipliers, gen prompts, volume/pitch variation, effects, and visuals — but keep each element on the bearing the plan gives it.');
  return lines.join('\n');
}

// ── Compilation verifier (uses parser + fast model repair) ──

const REPAIR_SYSTEM_PROMPT = `You are a Satie code repair specialist.

Fix the syntax errors in the provided Satie code. Output ONLY the corrected code.

CRITICAL SYNTAX RULES (NO COLONS, NO QUOTES, NO EQUALS):
- Statements: loop clip_name OR oneshot clip_name every 2to5
- Generate: loop gen descriptive prompt OR oneshot gen descriptive prompt every 2to5
- Variables: let name value (top level only, no reserved words)
- Properties: volume 0.5 (NOT volume = 0.5 or volume: 0.5)
- Properties: pitch 0.8to1.2 (space-separated, NO equals sign)
- Interpolation: volume fade 0 1 every 3 OR volume fade 0.2 0.8 every 5 loop bounce OR pitch jump 0.5 1.0 1.5 every 2 loop restart
- NEVER use goto, gobetween, or interpolate — they do NOT exist. Only "fade" and "jump"
- Loop modes on interpolation: "loop bounce" (oscillate) or "loop restart" (cycle)
- Placement: place <sector> <depth> [height] [extent] — sector: ahead behind left right ahead-left ahead-right behind-left behind-right surround overhead; depth: near mid far; height: low level high; extent: narrow wide surround
- Motion archetypes: move static | breathe | drift | swell | wander | dart | circle | pass [lr|rl] | approach | recede
- Low-level movement (also valid): move walk | move fly | move fly speed 1to3 | move fly x -5to5 y 0to3 z -5to5
- Movement types: archetypes above, or walk, fly, spiral, orbit, lorenz, gen — NEVER "fixed", "random", "position"
- A still voice uses "move static" or just "place ..." with no move — these are VALID, do not delete them
- Trajectories: move spiral OR move orbit OR move lorenz OR move gen flying bird
- Trajectory gen blocks: gen name + prompt/duration/smoothing/ground/variation (indented)
- Groups: ALWAYS give the group a name (e.g. "group ambience"). Group-level properties sit at the SAME indent as the "group" keyword, NOT indented under it. Child statements ARE indented.
- Multi-clip: oneshot bird and rain every 5
- Color: color red fade 0 255 every 5 green 0to255 blue 100
- Alpha: alpha 0.5 OR alpha fade 0 1 every 5 loop bounce
- Effects: delay wet 0.9 time 0.5 feedback 0.5 [pingpong] | reverb wet 0.8 size 0.9 damping 0.5 | filter mode lowpass cutoff 3000 resonance 1 | distortion mode tanh drive 2 | eq low 3 mid -2 high 1
- Visual: visual cloud-rain trail | visual bird trail | visual fire | visual waves | visual music-note trail
- Ranges: 0.5to1.0 (NO SPACES around 'to')
- Timing: start 5, end 30 fade 2, fade_in 1, fade_out 2
- Comments: # inline comment OR comment ... endcomment block
- NO explanations, NO markdown, NO text before/after code`;

export async function verifyAndRepair(
  code: string,
  maxAttempts: number = 2,
): Promise<{ success: boolean; code: string; error: string | null }> {
  let currentCode = code;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = tryParse(currentCode);

    if (result.success) {
      return { success: true, code: currentCode, error: null };
    }

    if (attempt === maxAttempts) {
      return { success: false, code: currentCode, error: result.errors };
    }

    try {
      const fastProvider = createFastProvider();
      const repaired = await callAI(
        fastProvider,
        REPAIR_SYSTEM_PROMPT,
        [{
          role: 'user',
          content: `CODE WITH ERRORS:\n${currentCode}\n\nPARSER ERRORS:\n${result.errors}\n\nFix these errors and output the corrected code ONLY.`,
        }],
        2000,
        0.2,
      );
      currentCode = cleanGeneratedCode(repaired);
    } catch {
      return { success: false, code: currentCode, error: result.errors };
    }
  }

  return { success: false, code, error: 'Failed to verify code' };
}

// ── Main orchestration pipeline ────────────────────────────

export async function generateCode(
  userPrompt: string,
  currentScript: string | undefined,
  loadedSamples: string[],
  conversationHistory: { role: string; content: string }[],
): Promise<{ code: string; error: string | null; costCents: number }> {
  const costBefore = getSessionCostCents();
  const hasExistingScript = !!(currentScript && currentScript.trim() && currentScript.trim() !== '# satie');
  const complex = isComplexPrompt(userPrompt, hasExistingScript);
  const provider = complex ? createProvider() : createFastProvider();
  const libraryResult = checkLibrary(userPrompt, loadedSamples);
  const systemPrompt = buildSystemPrompt(loadedSamples, libraryResult);

  // Spatial scene plan — only for fresh, complex scene generations. Edits to an
  // existing script already carry their placement, so we don't re-plan them.
  let scenePlanBlock = '';
  if (complex && !hasExistingScript) {
    const plan = await generateScenePlan(userPrompt, provider);
    if (plan) scenePlanBlock = formatScenePlanForPrompt(plan) + '\n\n';
  }

  const enrichedPrompt = scenePlanBlock + buildEnrichedPrompt(userPrompt, currentScript, libraryResult);

  const apiMessages = [
    ...conversationHistory,
    { role: 'user', content: enrichedPrompt },
  ];

  // Use smaller maxTokens for simple edits — they produce short output
  const maxTokens = complex ? 2048 : 1024;

  const rawResponse = await callAI(
    provider,
    systemPrompt,
    apiMessages,
    maxTokens,
    0.7,
  );

  const cleanedCode = cleanGeneratedCode(rawResponse);
  const verified = await verifyAndRepair(cleanedCode);

  return {
    code: verified.code,
    error: verified.error,
    costCents: getSessionCostCents() - costBefore,
  };
}

// ── Sample generation pipeline ─────────────────────────────

export async function generateSampleSpec(
  userPrompt: string,
): Promise<{ name: string; prompt: string }> {
  const provider = createFastProvider();
  const rawResponse = await callAI(
    provider,
    SAMPLE_GEN_SYSTEM_PROMPT,
    [{ role: 'user', content: userPrompt }],
    256,
    0.5,
  );

  // Parse JSON response
  const cleaned = rawResponse.trim().replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    return {
      name: String(parsed.name ?? 'sample').toLowerCase().replace(/[^a-z0-9_]/g, '_'),
      prompt: String(parsed.prompt ?? userPrompt),
    };
  } catch {
    // Fallback: use prompt as-is
    const name = userPrompt.split(/\s+/).slice(0, 2).join('_').toLowerCase().replace(/[^a-z0-9_]/g, '');
    return { name: name || 'sample', prompt: userPrompt };
  }
}

// ── Script scoring (HyperAgents-inspired evaluation) ──────

export interface ScriptScore {
  total: number;         // 0–1 composite score
  parseValid: boolean;
  voiceCount: number;
  spatialCoverage: number;  // 0–1 how spread out voices are
  dspRichness: number;      // 0–1 how many effects used
  interpolationUse: number; // 0–1 dynamic parameter changes
  detail: {
    hasReverb: boolean;
    hasDelay: boolean;
    hasFilter: boolean;
    hasDistortion: boolean;
    hasEQ: boolean;
    hasMovement: boolean;
    hasTrajectory: boolean;
    hasInterpolation: boolean;
    hasRanges: boolean;
    hasGroups: boolean;
  };
}

export function scoreScript(code: string): ScriptScore {
  const result = tryParse(code);

  const empty: ScriptScore = {
    total: 0,
    parseValid: false,
    voiceCount: 0,
    spatialCoverage: 0,
    dspRichness: 0,
    interpolationUse: 0,
    detail: {
      hasReverb: false, hasDelay: false, hasFilter: false,
      hasDistortion: false, hasEQ: false, hasMovement: false,
      hasTrajectory: false, hasInterpolation: false,
      hasRanges: false, hasGroups: false,
    },
  };

  if (!result.success || !result.statements || result.statements.length === 0) return empty;

  const stmts = result.statements;
  const voiceCount = stmts.reduce((sum, s) => sum + s.count, 0);

  // Spatial coverage: measure how spread voices are in 3D space
  const positions: { x: number; y: number; z: number }[] = [];
  for (const s of stmts) {
    const cx = (s.areaMin.x + s.areaMax.x) / 2;
    const cy = (s.areaMin.y + s.areaMax.y) / 2;
    const cz = (s.areaMin.z + s.areaMax.z) / 2;
    // Include area spread
    const spread = Math.abs(s.areaMax.x - s.areaMin.x) +
                   Math.abs(s.areaMax.y - s.areaMin.y) +
                   Math.abs(s.areaMax.z - s.areaMin.z);
    if (s.wanderType !== WanderType.None || spread > 0) {
      positions.push({ x: cx, y: cy, z: cz });
    }
  }

  let spatialCoverage = 0;
  if (positions.length >= 2) {
    let maxDist = 0;
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const dx = positions[i].x - positions[j].x;
        const dy = positions[i].y - positions[j].y;
        const dz = positions[i].z - positions[j].z;
        maxDist = Math.max(maxDist, Math.sqrt(dx * dx + dy * dy + dz * dz));
      }
    }
    spatialCoverage = Math.min(1, maxDist / 20); // 20 units = full spread
  }

  // DSP richness: count unique effects
  const dspFlags = {
    hasReverb: stmts.some(s => s.reverbParams !== null),
    hasDelay: stmts.some(s => s.delayParams !== null),
    hasFilter: stmts.some(s => s.filterParams !== null),
    hasDistortion: stmts.some(s => s.distortionParams !== null),
    hasEQ: stmts.some(s => s.eqParams !== null),
  };
  const dspCount = Object.values(dspFlags).filter(Boolean).length;
  const dspRichness = Math.min(1, dspCount / 3); // 3+ effects = max

  // Movement & trajectories
  const trajectoryTypes = new Set([WanderType.Spiral, WanderType.Orbit, WanderType.Lorenz, WanderType.Custom]);
  const hasMovement = stmts.some(s => s.wanderType !== WanderType.None);
  const hasTrajectory = stmts.some(s => trajectoryTypes.has(s.wanderType));

  // Interpolation usage
  const hasInterpolation = stmts.some(s =>
    s.volumeInterpolation !== null ||
    s.pitchInterpolation !== null ||
    s.moveSpeedInterpolation !== null ||
    s.reverbParams?.dryWetInterpolation !== null ||
    s.delayParams?.dryWetInterpolation !== null ||
    s.filterParams?.cutoffInterpolation !== null,
  );

  // Ranges (randomization)
  const hasRanges = stmts.some(s =>
    s.volume.min !== s.volume.max ||
    s.pitch.min !== s.pitch.max ||
    s.areaMin.x !== s.areaMax.x,
  );

  const hasGroups = /^\s*group\b/m.test(code);

  const interpolationUse = (hasInterpolation ? 0.5 : 0) + (hasRanges ? 0.3 : 0) + (hasGroups ? 0.2 : 0);

  // Composite score: weighted sum
  const total = Math.min(1,
    0.25 * Math.min(1, voiceCount / 4) +     // voice diversity (4+ voices = max)
    0.25 * spatialCoverage +                   // spatial spread
    0.20 * dspRichness +                       // DSP effects
    0.15 * interpolationUse +                  // dynamic changes
    0.10 * (hasMovement ? 1 : 0) +            // movement
    0.05 * (hasTrajectory ? 1 : 0),           // trajectory bonus
  );

  return {
    total,
    parseValid: true,
    voiceCount,
    spatialCoverage,
    dspRichness,
    interpolationUse,
    detail: {
      ...dspFlags,
      hasMovement,
      hasTrajectory,
      hasInterpolation,
      hasRanges,
      hasGroups,
    },
  };
}

// ── Feature 1: Ensemble generation ────────────────────────

export interface EnsembleCandidate {
  code: string;
  score: ScriptScore;
  error: string | null;
}

export interface EnsembleResult {
  best: EnsembleCandidate;
  candidates: EnsembleCandidate[];
  costCents: number;
}

/**
 * Generate N script candidates in parallel, score each, return ranked results.
 * Inspired by HyperAgents' archive + ensemble pattern.
 *
 * @param candidateCount Number of candidates to generate (default 3)
 * @param temperatures Spread of temperatures for diversity (default [0.5, 0.7, 0.9])
 */
export async function generateEnsemble(
  userPrompt: string,
  currentScript: string | undefined,
  loadedSamples: string[],
  conversationHistory: { role: string; content: string }[],
  candidateCount: number = 2,
  temperatures: number[] = [0.5, 0.8],
): Promise<EnsembleResult> {
  const costBefore = getSessionCostCents();
  const provider = createFastProvider();
  const libraryResult = checkLibrary(userPrompt, loadedSamples);
  // Ensemble already multiplies cost — skip RLHF examples and community search
  // to keep each candidate's prompt lean
  const systemPrompt = buildSystemPrompt(loadedSamples, libraryResult);
  const enrichedPrompt = buildEnrichedPrompt(userPrompt, currentScript, libraryResult);

  const apiMessages = [
    ...conversationHistory,
    { role: 'user', content: enrichedPrompt },
  ];

  // Generate N candidates in parallel with varying temperatures
  const promises = Array.from({ length: candidateCount }, (_, i) => {
    const temp = temperatures[i % temperatures.length];
    return callAI(provider, systemPrompt, apiMessages, 2048, temp)
      .then(async (raw) => {
        const cleaned = cleanGeneratedCode(raw);
        const verified = await verifyAndRepair(cleaned);
        const score = scoreScript(verified.code);
        return { code: verified.code, score, error: verified.error } as EnsembleCandidate;
      })
      .catch((err) => ({
        code: '',
        score: scoreScript(''),
        error: err.message,
      } as EnsembleCandidate));
  });

  const candidates = await Promise.all(promises);

  // Rank: valid parses first, then by total score descending
  candidates.sort((a, b) => {
    if (a.score.parseValid !== b.score.parseValid) return a.score.parseValid ? -1 : 1;
    return b.score.total - a.score.total;
  });

  return {
    best: candidates[0],
    candidates,
    costCents: getSessionCostCents() - costBefore,
  };
}

// ── Feature 2: Iterative refinement loop ──────────────────

export interface RefinementProgress {
  round: number;
  totalRounds: number;
  currentScore: number;
  improved: boolean;
}

/**
 * Iteratively refine a script over N rounds (autoresearch pattern).
 * Each round: ask AI to improve → score → keep if better, revert if not.
 *
 * @param onProgress Optional callback for progress updates
 */
export async function refineScript(
  script: string,
  userPrompt: string,
  loadedSamples: string[],
  rounds: number = 2,
  onProgress?: (progress: RefinementProgress) => void,
): Promise<{ code: string; score: ScriptScore; improvements: string[]; costCents: number }> {
  const costBefore = getSessionCostCents();
  let currentCode = script;
  let currentScore = scoreScript(script);
  const improvements: string[] = [];

  const provider = createFastProvider();
  const libraryResult = checkLibrary(userPrompt, loadedSamples);

  const refinementPrompt = `You are a spatial audio composition expert refining a Satie script.
Output ONLY the improved Satie code. No explanations, no markdown.

IMPROVEMENT PRIORITIES (focus on the weakest areas):
- Spatial spread: voices should use varied positions, movement types, and trajectories
- DSP richness: add reverb, delay, filter, or EQ where musically appropriate
- Dynamic evolution: use interpolation (fade/jump), ranges, and parameter changes over time
- Voice variation: use count multipliers with ranges instead of duplicating statements
- Musical coherence: ensure volumes, pitches, and effects serve the overall composition

RULES:
- Keep the original artistic intent intact
- Make ONE focused improvement per round (don't rewrite everything)
- Preserve all existing voices and their core character
- NEVER change gen prompts (e.g. keep "gen gentle rain" exactly as-is). Changing gen text triggers expensive audio re-generation. Only modify properties like volume, pitch, move, effects — never the gen prompt text itself.
- ALWAYS output the COMPLETE script`;

  for (let round = 0; round < rounds; round++) {
    // Build improvement suggestion based on current weaknesses
    const weaknesses: string[] = [];
    if (currentScore.spatialCoverage < 0.5) weaknesses.push('voices are clustered — spread them in 3D space with varied move types');
    if (currentScore.dspRichness < 0.5) weaknesses.push('few/no DSP effects — add reverb, delay, or filter where fitting');
    if (currentScore.interpolationUse < 0.3) weaknesses.push('static parameters — add interpolation (fade/jump) for evolution over time');
    if (!currentScore.detail.hasMovement) weaknesses.push('no spatial movement — add walk/fly/orbit to at least some voices');
    if (!currentScore.detail.hasRanges) weaknesses.push('no randomization — use ranges (e.g., 0.3to0.7) for natural variation');
    if (currentScore.voiceCount < 3) weaknesses.push('few voices — consider layering or using count multipliers');

    const focusArea = weaknesses.length > 0
      ? `FOCUS THIS ROUND: ${weaknesses[round % weaknesses.length]}`
      : 'Script is already well-composed. Make a subtle artistic enhancement.';

    try {
      const rawResponse = await callAI(
        provider,
        refinementPrompt,
        [{
          role: 'user',
          content: `CURRENT SCRIPT (score: ${(currentScore.total * 100).toFixed(0)}%):\n${currentCode}\n\nORIGINAL REQUEST: ${userPrompt}\n\n${focusArea}`,
        }],
        2048,
        0.5, // lower temperature for controlled refinement
      );

      const cleaned = cleanGeneratedCode(rawResponse);
      const verified = await verifyAndRepair(cleaned);

      if (verified.success) {
        const newScore = scoreScript(verified.code);

        // Autoresearch pattern: keep only if improved
        if (newScore.total > currentScore.total) {
          const delta = ((newScore.total - currentScore.total) * 100).toFixed(1);
          improvements.push(`Round ${round + 1}: +${delta}% — ${weaknesses[round % weaknesses.length] ?? 'artistic enhancement'}`);
          currentCode = verified.code;
          currentScore = newScore;
        }
      }
    } catch {
      // Non-fatal: skip this round
    }

    onProgress?.({
      round: round + 1,
      totalRounds: rounds,
      currentScore: currentScore.total,
      improved: improvements.length > 0,
    });
  }

  return { code: currentCode, score: currentScore, improvements, costCents: getSessionCostCents() - costBefore };
}

// ── RLHF ──────────────────────────────────────────────────
//
// Feedback is collected via thumbs up/down in the UI and stored
// in IndexedDB (see feedbackStore.ts). It is NOT injected into
// AI prompts — that approach inflated token cost on every call
// for marginal benefit.
//
// The FeedbackDashboard component reads this data for a read-only
// view of user preferences. In the future, this data can be used
// for offline fine-tuning or batch prompt optimization.
