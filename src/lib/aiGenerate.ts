/**
 * AI generation pipeline — extracted from AIPanel.tsx for reuse.
 * Pure functions with no React dependencies.
 */

import { tryParse } from '../engine/core/SatieParser';
import {
  createProvider,
  createFastProvider,
  type AIProvider,
} from './aiProvider';
import {
  getTopExamples,
  getAntiPatterns,
  type StoredFeedback,
} from './feedbackStore';

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

export function buildSystemPrompt(
  loadedSamples: string[],
  libraryResult: LibraryCheckResult,
  topExamples: StoredFeedback[] = [],
  antiPatterns: StoredFeedback[] = [],
): string {
  let audioLibrary: string;
  if (loadedSamples.length > 0) {
    audioLibrary = `AVAILABLE AUDIO FILES (use EXACT names):\n${loadedSamples.map(s => `  - ${s}`).join('\n')}\n\nUse these when available. For sounds NOT in the library, use the gen keyword.`;
  } else {
    audioLibrary = 'No audio files loaded. Use gen keyword to generate sounds (e.g. loop gen gentle rain on leaves).';
  }

  return `You are Satie, a spatial audio composition assistant. You think like a composer and write code in the Satie DSL.

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

═══ COMPOSITIONAL PATTERNS ═══

VARIATION THROUGH MULTIPLICATION (the idiomatic way):
  3 * loop gen gentle wind
      volume 0.2to0.5
      pitch 0.8to1.3
      move fly x -8to8 y -2to4 z -8to8
      start 0to3
  → Creates 3 voices, each with different random volume, pitch, position, timing

LAYERING (building texture):
  group
      volume 0.5
      reverb 0.3 0.7 0.5
      move fly x -5to5 y 0to3 z -5to5

      loop gen warm pad drone
          volume 0.3
          pitch 0.5

      loop gen bright shimmer texture
          volume 0.15
          pitch 2.0
  endgroup

EVOLVING PARAMETERS (temporal change):
  loop gen ocean waves
      volume fade 0.1 0.5 every 8 loop bounce
      filter lowpass cutoff fade 400 3000 every 12 loop bounce

RHYTHMIC PATTERNS (generative timing):
  3 * oneshot gen wooden percussion tap every 0.3to0.8
      volume 0.3to0.7
      pitch 0.8to1.5
      move walk x -3to3 z -3to3

SPATIAL DEPTH (positioning voices):
  - Close: move fixed 0 0 -2
  - Far: move fixed 0 0 -15
  - Moving: move fly x -10to10 y -3to5 z -10to10 speed 0.3
  - Orbiting: move orbit x -3to3 y 0to2 z -3to3 speed 0.2

═══ SYNTAX REFERENCE ═══

STATEMENTS:
  loop clip_name                     # loop a file
  oneshot clip_name every 2to5       # retrigger
  3 * loop clip_name                 # multiply voices
  loop gen descriptive prompt        # AI-generated audio

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

MOVEMENT:
  move walk                                        # ground plane
  move fly                                         # 3D space
  move fly x -10to10 y 0to5 z -10to10 speed 2     # constrained area
  move spiral speed 0.5 noise 0.3                  # trajectory
  move orbit | move lorenz                         # other trajectories
  move gen flying bird speed 0.5                   # AI-generated path

GROUPS:
  group
      volume 0.5
      reverb 0.3 0.7 0.5
      loop sound1
      loop sound2
  endgroup

EFFECTS (use only when requested or musically relevant):
  reverb 0.4 0.7 0.5                              # wet size damping
  delay 0.3 0.25 0.5                               # wet time feedback
  delay 0.3 0.25 0.5 pingpong                      # stereo delay
  filter lowpass cutoff 800 resonance 2             # filter
  distortion softclip drive 3 wet 0.5              # distortion
  eq 3 -2 1                                        # low mid high (dB)

COLOR & VISUALS:
  color #FF5733 | color red | color red 200 green 100 blue 50
  alpha 0.5
  visual sphere | visual trail | visual trail+sphere | visual trail+cube

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

═══ CRITICAL RULES ═══

- Properties use SPACES, never = or : (volume 0.5, NOT volume=0.5)
- Ranges use 'to' without spaces (0.5to1.0)
- Keep it MINIMAL — only add what the user asks for
- When modifying existing code, PRESERVE everything unless asked to change it
- Prefer ranges and count multipliers over copy-pasting statements
- Think about musical relationships: bass is low pitch, high voices are high pitch
- Think about spatial relationships: spread voices apart, use movement for life
- ALWAYS add visual: voices with movement (walk/fly/spiral/orbit/lorenz/gen) → "visual trail", static voices → "visual sphere"

${audioLibrary}
${topExamples.length > 0 ? `
PROVEN PATTERNS (user-approved — follow these):
${topExamples.map((ex, i) => `${i + 1}. "${ex.prompt}" →\n${(ex.userEditedOutput ?? ex.output).slice(0, 400)}`).join('\n\n')}` : ''}
${antiPatterns.length > 0 ? `
REJECTED PATTERNS (avoid):
${antiPatterns.map((ex, i) => `${i + 1}. "${ex.prompt}" → rejected:\n${ex.output.slice(0, 200)}`).join('\n\n')}` : ''}`;
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

// ── Compilation verifier (uses parser + fast model repair) ──

const REPAIR_SYSTEM_PROMPT = `You are a Satie code repair specialist.

Fix the syntax errors in the provided Satie code. Output ONLY the corrected code.

CRITICAL SYNTAX RULES (NO COLONS, NO QUOTES, NO EQUALS):
- Statements: loop audio/file (NOT loop "audio/file": or loop = "audio/file")
- Statements: oneshot audio/file every 2to5
- Generate: loop gen descriptive prompt OR oneshot gen descriptive prompt every 2to5
- Variables: let name value (top level only, no reserved words)
- Properties: volume 0.5 (NOT volume = 0.5 or volume: 0.5)
- Properties: pitch 0.8to1.2 (space-separated, NO equals sign)
- Interpolation: goto(0and0.2 in 5) OR gobetween(1and2 in 10) OR interpolate(0and1 as incubic in 5)
- Repeat: gobetween(0and1 in 5 for 3) OR for ever
- Easing: insine, outsine, inquad, incubic, inoutcubic, inexpo, inback, inelastic, inbounce, etc.
- Movement: move walk OR move fly speed 1to3 OR move fly x -10to10 y 0to15 z -10to5 speed 2
- Trajectories: move spiral OR move orbit OR move lorenz OR move gen flying bird
- Trajectory gen blocks: gen name + prompt/duration/smoothing/ground/variation (indented)
- Groups: group ... endgroup (volume/pitch multiply with parent)
- Multi-clip: oneshot bird and rain every 5
- Color: color red gobetween(0and255 as incubic in 20) green 0to255 blue 100
- Alpha: alpha 0.5 OR color #FF0000 alpha gobetween(0and1 in 5)
- Effects: delay wet 0.9 time 0.5 feedback 0.5 [pingpong] | reverb wet 0.8 size 0.9 damping 0.5 | filter mode lowpass cutoff 3000 resonance 1 | distortion mode tanh drive 2 | eq low 3 mid -2 high 1
- Visual: visual trail OR visual sphere OR visual trail cube
- Ranges: 0.5to1.0 (NO SPACES around 'to')
- Timing: start 5, end 30 fade 2, fadein 1, fadeout 2
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
): Promise<{ code: string; error: string | null }> {
  const provider = createProvider();
  const libraryResult = checkLibrary(userPrompt, loadedSamples);
  const [topEx, antiEx] = await Promise.all([
    getTopExamples('script', 3),
    getAntiPatterns('script', 2),
  ]);
  const systemPrompt = buildSystemPrompt(loadedSamples, libraryResult, topEx, antiEx);
  const enrichedPrompt = buildEnrichedPrompt(userPrompt, currentScript, libraryResult);

  const apiMessages = [
    ...conversationHistory,
    { role: 'user', content: enrichedPrompt },
  ];

  const rawResponse = await callAI(
    provider,
    systemPrompt,
    apiMessages,
    2048,
    0.7,
  );

  const cleanedCode = cleanGeneratedCode(rawResponse);
  const verified = await verifyAndRepair(cleanedCode);

  return {
    code: verified.code,
    error: verified.error,
  };
}

// ── Sample generation pipeline ─────────────────────────────

export async function generateSampleSpec(
  userPrompt: string,
): Promise<{ name: string; prompt: string }> {
  const provider = createProvider();
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
