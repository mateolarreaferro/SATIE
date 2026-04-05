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
  type AIProvider,
} from './aiProvider';
import {
  getTopExamples,
  getAntiPatterns,
  type StoredFeedback,
} from './feedbackStore';
import { searchCommunity, formatCommunitySamplesForPrompt } from './communitySearch';
import type { CommunitySample } from './communitySamples';

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
  communitySamples: CommunitySample[] = [],
): string {
  let audioLibrary: string;
  if (loadedSamples.length > 0) {
    audioLibrary = `AVAILABLE AUDIO FILES (use EXACT names):\n${loadedSamples.map(s => `  - ${s}`).join('\n')}\n\nUse these when available. For sounds NOT in the library, use the gen keyword.`;
  } else {
    audioLibrary = 'No audio files loaded. Use gen keyword to generate sounds (e.g. loop gen gentle rain on leaves).';
  }

  // Append community samples if available
  const communitySection = formatCommunitySamplesForPrompt(communitySamples);
  if (communitySection) {
    audioLibrary += '\n' + communitySection;
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

═══ CRITICAL RULES ═══

- Properties use SPACES, never = or : (volume 0.5, NOT volume=0.5)
- Ranges use 'to' without spaces (0.5to1.0)
- Keep it MINIMAL — only add what the user asks for
- When modifying existing code, PRESERVE everything unless asked to change it
- Prefer ranges and count multipliers over copy-pasting statements
- Think about musical relationships: bass is low pitch, high voices are high pitch
- Think about spatial relationships: spread voices apart, use movement for life
- ALWAYS add visual with a semantic icon name matching the sound. Moving voices get trail too. Examples: "visual cloud-rain trail", "visual bird trail", "visual fire", "visual waves", "visual lightning trail". Available icon names: lightning, bird, fire, wind, cloud-rain, cloud-snow, cloud-lightning, waves, drop, sun, moon, star, campfire, tree, leaf, flower, mountains, flame, meteor, planet, globe, tent, city, buildings, factory, siren, bell, guitar, piano-keys, music-note, music-notes, vinyl-record, speaker-high, microphone-stage, waveform, radio, dog, cat, fish, horse, butterfly, paw-print, person-simple-walk, footprints, car, train, boat, rocket, robot, alien, ghost, skull, heartbeat, brain, eye, clock, gear, bomb, snowflake, rainbow, wave-sine, church, sword, shield, diamond, crown. NEVER use "visual sphere" — always pick an icon. For moving voices use "visual iconname trail". For static voices use "visual iconname".

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
- Visual: visual cloud-rain trail | visual bird trail | visual fire | visual waves | visual music-note trail
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
  const keywords = extractSoundKeywords(userPrompt.toLowerCase());
  const [topEx, antiEx, communitySamples] = await Promise.all([
    getTopExamples('script', 3),
    getAntiPatterns('script', 2),
    searchCommunity(userPrompt, keywords, 10).catch(() => [] as CommunitySample[]),
  ]);
  const systemPrompt = buildSystemPrompt(loadedSamples, libraryResult, topEx, antiEx, communitySamples);
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

  const hasGroups = code.includes('group') && code.includes('endgroup');

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
  candidateCount: number = 3,
  temperatures: number[] = [0.5, 0.7, 0.9],
): Promise<EnsembleResult> {
  const provider = createProvider();
  const libraryResult = checkLibrary(userPrompt, loadedSamples);
  const keywords = extractSoundKeywords(userPrompt.toLowerCase());
  const [topEx, antiEx, communitySamples] = await Promise.all([
    getTopExamples('script', 3),
    getAntiPatterns('script', 2),
    searchCommunity(userPrompt, keywords, 10).catch(() => [] as CommunitySample[]),
  ]);
  const systemPrompt = buildSystemPrompt(loadedSamples, libraryResult, topEx, antiEx, communitySamples);
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
  rounds: number = 3,
  onProgress?: (progress: RefinementProgress) => void,
): Promise<{ code: string; score: ScriptScore; improvements: string[] }> {
  let currentCode = script;
  let currentScore = scoreScript(script);
  const improvements: string[] = [];

  const provider = createProvider();
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

  return { code: currentCode, score: currentScore, improvements };
}

// ── Feature 3: Self-improving system prompts ──────────────

export interface PromptEffectiveness {
  patternName: string;
  successRate: number;  // 0–1 based on feedback scores
  sampleSize: number;
}

/**
 * Analyze RLHF feedback to determine which compositional patterns
 * are most effective, then build an adaptive system prompt that
 * emphasizes proven patterns and de-emphasizes rejected ones.
 */
export async function buildAdaptiveSystemPrompt(
  loadedSamples: string[],
  libraryResult: LibraryCheckResult,
  communitySamples: CommunitySample[] = [],
): Promise<{ prompt: string; effectiveness: PromptEffectiveness[] }> {
  // Gather more feedback than usual to analyze patterns
  const [topEx, antiEx, allPositive, allNegative] = await Promise.all([
    getTopExamples('script', 5),
    getAntiPatterns('script', 5),
    getTopExamples('script', 20),
    getAntiPatterns('script', 20),
  ]);

  // Analyze which patterns appear in successful vs failed generations
  const patternDetectors: { name: string; test: (code: string) => boolean }[] = [
    { name: 'count_multiplier', test: (c) => /\d+\s*\*\s*(loop|oneshot)/.test(c) },
    { name: 'groups', test: (c) => c.includes('group') && c.includes('endgroup') },
    { name: 'reverb', test: (c) => /reverb\s/.test(c) },
    { name: 'delay', test: (c) => /delay\s/.test(c) },
    { name: 'filter', test: (c) => /filter\s/.test(c) },
    { name: 'interpolation', test: (c) => /\b(fade|jump|gobetween|interpolate)\b/.test(c) },
    { name: 'ranges', test: (c) => /\d+to\d+/.test(c) },
    { name: 'movement', test: (c) => /move\s+(walk|fly|orbit|spiral|lorenz)/.test(c) },
    { name: 'trajectory', test: (c) => /move\s+(spiral|orbit|lorenz|gen)/.test(c) },
    { name: 'visual_trail', test: (c) => /visual\s+trail/.test(c) },
    { name: 'gen_audio', test: (c) => /\bgen\s+\w/.test(c) },
    { name: 'variables', test: (c) => /\blet\s+\w/.test(c) },
  ];

  const effectiveness: PromptEffectiveness[] = patternDetectors.map(({ name, test }) => {
    const positiveHits = allPositive.filter(f => {
      const code = f.userEditedOutput ?? f.output;
      return test(code);
    }).length;
    const negativeHits = allNegative.filter(f => test(f.output)).length;
    const total = positiveHits + negativeHits;
    return {
      patternName: name,
      successRate: total > 0 ? positiveHits / total : 0.5, // default neutral
      sampleSize: total,
    };
  });

  // Build adaptive sections: boost high-success patterns, add warnings for low-success ones
  const boosted = effectiveness
    .filter(e => e.sampleSize >= 2 && e.successRate >= 0.7)
    .map(e => e.patternName);

  const warned = effectiveness
    .filter(e => e.sampleSize >= 2 && e.successRate <= 0.3)
    .map(e => e.patternName);

  const patternNameToAdvice: Record<string, string> = {
    count_multiplier: 'Use count multipliers (N * loop) for voice variation — proven effective',
    groups: 'Use groups for shared properties — users approve of clean organization',
    reverb: 'Reverb is frequently well-received — include when fitting',
    delay: 'Delay effects are appreciated — use for rhythmic interest',
    filter: 'Filters add expressiveness — use for timbral variation',
    interpolation: 'Interpolation (fade/jump) makes compositions feel alive — use generously',
    ranges: 'Ranges (e.g., 0.3to0.7) add organic variation — strongly preferred',
    movement: 'Spatial movement is a key differentiator — add walk/fly when appropriate',
    trajectory: 'Trajectories (spiral/orbit/lorenz) create compelling spatial motion',
    visual_trail: 'Visual trails enhance the experience for moving voices',
    gen_audio: 'Generated audio (gen keyword) works well when samples aren\'t available',
    variables: 'Variables (let) help with consistency across voices',
  };

  let adaptiveSection = '';
  if (boosted.length > 0) {
    adaptiveSection += '\n\n═══ PROVEN EFFECTIVE (use these confidently) ═══\n';
    adaptiveSection += boosted.map(name => `✓ ${patternNameToAdvice[name] ?? name}`).join('\n');
  }
  if (warned.length > 0) {
    adaptiveSection += '\n\n═══ USE WITH CAUTION (often rejected by users) ═══\n';
    adaptiveSection += warned.map(name => `✗ ${name}: this pattern was frequently rejected — use sparingly`).join('\n');
  }

  const basePrompt = buildSystemPrompt(loadedSamples, libraryResult, topEx, antiEx, communitySamples);
  const prompt = basePrompt + adaptiveSection;

  return { prompt, effectiveness };
}

/**
 * Enhanced generateCode that uses adaptive prompts when sufficient feedback exists.
 * Drop-in replacement for generateCode with self-improving behavior.
 */
export async function generateCodeAdaptive(
  userPrompt: string,
  currentScript: string | undefined,
  loadedSamples: string[],
  conversationHistory: { role: string; content: string }[],
): Promise<{ code: string; error: string | null; effectiveness?: PromptEffectiveness[] }> {
  const provider = createProvider();
  const libraryResult = checkLibrary(userPrompt, loadedSamples);
  const keywords = extractSoundKeywords(userPrompt.toLowerCase());
  const communitySamples = await searchCommunity(userPrompt, keywords, 10).catch(() => [] as CommunitySample[]);

  const { prompt: systemPrompt, effectiveness } = await buildAdaptiveSystemPrompt(
    loadedSamples,
    libraryResult,
    communitySamples,
  );

  const enrichedPrompt = buildEnrichedPrompt(userPrompt, currentScript, libraryResult);

  const apiMessages = [
    ...conversationHistory,
    { role: 'user', content: enrichedPrompt },
  ];

  const rawResponse = await callAI(provider, systemPrompt, apiMessages, 2048, 0.7);
  const cleanedCode = cleanGeneratedCode(rawResponse);
  const verified = await verifyAndRepair(cleanedCode);

  return {
    code: verified.code,
    error: verified.error,
    effectiveness,
  };
}
