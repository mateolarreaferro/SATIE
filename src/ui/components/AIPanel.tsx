import { useState, useRef, useCallback, useEffect } from 'react';
import { tryParse } from '../../engine/core/SatieParser';
import { generateTrajectoryFromPrompt } from '../../engine/spatial/TrajectoryGen';
import {
  createProvider,
  createFastProvider,
  getPreferredProvider,
  setPreferredProvider,
  getAvailableProviders,
  type AIProviderType,
  type AIProvider,
} from '../../lib/aiProvider';
import {
  saveFeedback,
  updateFeedback,
  getTopExamples,
  getAntiPatterns,
  createFeedbackEntry,
  type StoredFeedback,
} from '../../lib/feedbackStore';

export type AITarget = 'script' | 'sample' | 'trajectory';

interface AIPanelProps {
  onGenerate: (code: string) => void;
  onGenerateSample: (name: string, prompt: string) => void;
  onGenerateTrajectory?: (name: string, prompt: string) => void;
  currentScript?: string;
  loadedSamples?: string[];
  target: AITarget;
  onTargetChange: (target: AITarget) => void;
  /** Called when a new generation is saved to feedback store (for implicit edit tracking) */
  onFeedbackCreated?: (feedbackId: string, baseline: string) => void;
}

interface HistoryEntry {
  prompt: string;
  result: string;
  timestamp: number;
  target: AITarget;
  feedbackId: string | null;
}

// ── ASR: Microphone → Whisper transcription ────────────────

async function transcribeAudio(audioBlob: Blob): Promise<string> {
  const apiKey = localStorage.getItem('satie-openai-key') ?? '';
  if (!apiKey) throw new Error('Set your OpenAI key in dashboard settings first.');

  const form = new FormData();
  form.append('file', audioBlob, 'audio.webm');
  form.append('model', 'whisper-1');
  form.append('language', 'en');
  form.append('response_format', 'json');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: form,
  });

  if (!res.ok) throw new Error(`Whisper API ${res.status}`);
  const data = await res.json();
  return data.text ?? '';
}

function useASR(onTranscription: (text: string) => void, onError: (msg: string) => void) {
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startTime = useRef(0);

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      chunks.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const elapsed = Date.now() - startTime.current;
        setRecording(false);
        if (elapsed < 300) return;

        const blob = new Blob(chunks.current, { type: 'audio/webm' });
        setTranscribing(true);
        try {
          const text = await transcribeAudio(blob);
          if (text.trim()) onTranscription(text.trim());
        } catch (e: any) {
          onError(e.message);
        } finally {
          setTranscribing(false);
        }
      };

      mediaRecorder.current = recorder;
      startTime.current = Date.now();
      recorder.start();
      setRecording(true);
    } catch {
      onError('Microphone access denied');
    }
  }, [onTranscription, onError]);

  const stop = useCallback(() => {
    if (mediaRecorder.current?.state === 'recording') {
      mediaRecorder.current.stop();
    }
  }, []);

  return { recording, transcribing, start, stop };
}

// ── Code cleaning ──────────────────────────────────────────

function cleanGeneratedCode(raw: string): string {
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

interface LibraryCheckResult {
  availableSamples: string[];
  missingSamples: string[];
}

function checkLibrary(prompt: string, loadedSamples: string[]): LibraryCheckResult {
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

// ── AI call helper (provider-agnostic) ─────────────────────

async function callAI(
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

/** Legacy wrapper — still used by older call sites during migration */
async function callAnthropic(
  apiKey: string,
  _model: string,
  systemPrompt: string,
  messages: { role: string; content: string }[],
  maxTokens: number = 2048,
  temperature: number = 0.7,
): Promise<string> {
  const provider = createProvider();
  return callAI(provider, systemPrompt, messages, maxTokens, temperature);
}

// ── System prompt (ported from Unity SatieAgentOrchestrator) ──

function buildSystemPrompt(
  loadedSamples: string[],
  libraryResult: LibraryCheckResult,
  topExamples: StoredFeedback[] = [],
  antiPatterns: StoredFeedback[] = [],
): string {
  let audioLibrary: string;
  if (loadedSamples.length > 0) {
    audioLibrary = `AVAILABLE AUDIO FILES (use EXACT names):\n${loadedSamples.map(s => `  - ${s}`).join('\n')}\n\nIMPORTANT: Use audio files from the above list when available. For sounds NOT in the library, use the gen keyword to generate them. Do NOT make up file paths.`;
  } else {
    audioLibrary = 'No audio files loaded yet. Use the gen keyword to generate sounds (e.g. loop gen gentle rain on leaves).';
  }

  return `You are Satie, a spatial audio composition engine. You write code in the Satie DSL.

Output ONLY valid Satie code. No explanations, no markdown, no text before or after the code.

STRICT RULES:
- Your response must be pure Satie code only
- NO explanations or descriptions
- NO markdown code blocks
- NO "Here's your code" or similar text
- Start directly with the Satie code
- End directly with the Satie code

SIMPLICITY PRINCIPLE - CRITICAL:
- ONLY add features the user explicitly requested
- DO NOT add: visuals, color, reverb, delay, filters, randomstart, pitch variations UNLESS asked
- Keep it minimal - use basic volume levels, no fancy modulation unless requested
- Less is more - don't show off all available features
- If user wants complexity, they will ask for it explicitly

EXAMPLE - User says "rain and piano flying":
CORRECT (simple):
loop rain
    volume 0.2

oneshot piano_note_1 every 2to5
    volume 0.3
    move fly

WRONG (over-engineered):
loop rain
    volume 0.3
    filter mode lowpass cutoff 2000
    reverb wet 0.4 size 0.8

oneshot piano_note_1 every 2to4
    pitch 0.8to1.2
    move fly speed 1to3
    visual trail sphere
    color red gobetween(100and255 as incubic in 5) green 150to200 blue 100
    reverb wet 0.6 size 0.9
    randomstart

CRITICAL SYNTAX RULES (NO COLONS, NO QUOTES, NO EQUALS):
- Statements: loop audio/file (NOT loop "audio/file": or loop = "audio/file")
- Statements: oneshot audio/file every 2to5 (NOT oneshot "audio/file": every 2to5)
- Properties: volume 0.5 (NOT volume = 0.5 or volume: 0.5)
- Properties: pitch 0.8to1.2 (space-separated, NO equals)
- Ranges: 0.5to1.0 (NO SPACES around 'to')
- Numbers: Use dots not commas (0.5 not 0,5)

VARIABLES:
- Define reusable values at the top level (no indentation)
- Syntax: let name value
- Usage: reference the variable name in any property value
- Examples:
    let baseVol 0.5
    let basePitch 0.9to1.1
    loop rain
        volume baseVol
        pitch basePitch
- Variable names cannot be reserved words (loop, oneshot, volume, etc.)

INTERPOLATION (goto, gobetween, interpolate):
- goto: Interpolates from start to target value once
  Examples: volume goto(0and0.2 in 5)
           pitch goto(0and1.5 in 10)
           volume goto(0and0.1to0.15 in .5)
- gobetween: Oscillates between two values continuously
  Examples: pitch gobetween(1and2 in 10)
           filter mode lowpass cutoff gobetween(300and3000 in 15)
           color red gobetween(0and255 as incubic in 20)
           reverb wet gobetween(0.1and1 in 10)
- interpolate: Smooth interpolation with easing (does not repeat by default)
  Examples: interpolate(0.8and1.2 as incubic in 10)
           interpolate(0and1 as outsine in 5 for 2)
- Repeat control: add "for N" to repeat N times, or "for ever" to repeat forever
  Examples: gobetween(0and1 in 5 for 3)
           interpolate(0and1 as incubic in 10 for ever)
- Easing functions (optional, default linear):
  Sine: insine, outsine, inoutsine
  Quad: inquad, outquad, inoutquad
  Cubic: incubic, outcubic, inoutcubic
  Quart: inquart, outquart, inoutquart
  Expo: inexpo, outexpo, inoutexpo
  Circ: incirc, outcirc, inoutcirc
  Back: inback, outback, inoutback
  Elastic: inelastic, outelastic, inoutelastic
  Bounce: inbounce, outbounce, inoutbounce
  Oscillating: sine, sinereturn, cosinereturn, elasticreturn, bouncereturn

MOVEMENT (critical for spatial depth):
- move walk: Ground movement (X and Z axes, Y fixed at 0)
  Example: move walk
- move fly: 3D movement (X, Y, Z axes)
  Example: move fly speed 1to3
- move with ranges: Specify exact ranges per axis
  Example: move fly x -10to10 y 0to15 z -10to5 speed 2to3
  Example: move walk x 0to0 z 10to10
- Trajectories (predefined paths):
  move spiral, move orbit, move lorenz
  Example: move spiral speed 0.5 noise 0.2
  Example: move orbit x -3to3 y 0to5 z -3to3
- Custom trajectory by name: move mytrajectory
- AI-generated trajectory (inline): move gen descriptive prompt
  Example: move gen flying bird
  Example: move gen bouncing ball speed 2 noise 0.3
- Speed: move fly speed 0.5 | move walk speed 2to5
  Speed can also use interpolation: move fly speed goto(1and3 in 10)
- Noise: adds jitter to any movement path (0-1)
  Example: move orbit noise 0.4

TRAJECTORY GEN BLOCKS (define named AI-generated trajectories):
- Syntax:
    gen mytrajectory
        prompt bird flying in spiraling pattern
        duration 15
        resolution 4096
        smoothing 0.3
        ground
        variation 0.8
- Properties: prompt (required), duration (cycle seconds, default 30),
  resolution (LUT points, default 8192), smoothing (0-1, default 0),
  seed (int, default 0=random), ground (flag, constrain to Y=0),
  variation (speed variation 0-1, default 0.5)
- A gen block is detected as a trajectory (not audio) if it contains:
  smoothing, resolution, seed, ground, or variation
- Usage: reference in move property: move mytrajectory

GROUPS (property inheritance):
- Syntax:
    group
        volume 0.5
        color red
        loop sound1
            pitch 0.8
        loop sound2
            pitch 1.2
    endgroup
- Group properties apply to all children
- Child properties override group defaults
- volume and pitch MULTIPLY with group values
- move and visual are NOT allowed on groups

MULTI-CLIP SHORTHAND:
- Use "and" to apply the same settings to multiple clips
  Example: oneshot bird and rain and wind every 5
      volume 0.5
- This expands each clip into a separate statement with the same properties

COLOR (for visual objects):
- Basic colors: color red, color blue, color green, color yellow, color white
- Hex: color #FF5733
- RGB values: color red 255 green 0 blue 100
- With ranges: color red 0to255 green 100 blue 50to200
- With interpolation: color red gobetween(0and255 as incubic in 20) green 0to255 blue gobetween(0and155 in 15)
- Alpha: alpha 0.5 OR color #FFFFFF alpha gobetween(0and1 in 5)

VISUAL OBJECTS:
- visual trail: Trail effect behind sound
- visual sphere: Sphere object
- visual cube: Cube object
- Combine: visual trail sphere

AUDIO EFFECTS (only if requested):
- Delay: delay wet 0.9 time 0.5to0.9 feedback 0.2to1
- Delay pingpong: delay wet 0.5 time 0.375 feedback 0.5 pingpong
- Reverb: reverb wet 0.8 size 0.9 damping 0.5
- Filter: filter mode lowpass cutoff 3000 resonance 1 wet 1
  Modes: lowpass, highpass, bandpass, notch, peak
- Distortion: distortion mode tanh drive 2 wet 1
  Modes: softclip, hardclip, tanh, cubic, asymmetric
- EQ: eq low 3 mid -2 high 1
- All DSP parameters can use interpolation (goto, gobetween)

AUDIO GENERATION (gen keyword):
- When a sound is NOT available in the library, use the gen keyword
- Syntax: loop gen descriptive prompt OR oneshot gen descriptive prompt every 2to5
- Examples: loop gen fire with crackles | oneshot gen thunder rumble every 5to15
- The prompt should be descriptive (e.g. "gentle rain on leaves" not just "rain")
- Use gen ONLY for sounds not available in the library - prefer existing samples
- Gen blocks (named, reusable):
    gen ethereal_pad
        prompt ethereal ambient pad with sustained notes
        duration 3
        influence 0.8
        loopable
  Then use: loop ethereal_pad

OTHER PROPERTIES:
- start 5: Delay before first playback (seconds)
- end 30: Stop playback at time (seconds)
- end 30 fade 2: Stop with 2-second fade-out
- fadein 1: Fade-in duration
- fadeout 2: Fade-out duration
- overlap: Allow voices to overlap
- persistent: Keep playing across loops
- randomstart: Start at random position in clip

COMMENTS:
- Inline: # this is a comment
- Block: comment ... endcomment

${audioLibrary}
${topExamples.length > 0 ? `
PROVEN EXAMPLES (highly rated by the user — follow these patterns):
${topExamples.map((ex, i) => `${i + 1}. User asked: "${ex.prompt}"
${(ex.userEditedOutput ?? ex.output).slice(0, 500)}`).join('\n\n')}` : ''}
${antiPatterns.length > 0 ? `
AVOID THESE PATTERNS (negatively rated — do NOT produce similar code):
${antiPatterns.map((ex, i) => `${i + 1}. User asked: "${ex.prompt}" but this was rejected:
${ex.output.slice(0, 300)}`).join('\n\n')}` : ''}

Generate valid Satie code following these exact syntax rules.`;
}

// ── Sample generation system prompt ────────────────────────

const SAMPLE_GEN_SYSTEM_PROMPT = `You are a sound designer. The user will describe a sound they want generated.

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

// ── Enriched prompt (ported from Unity BuildEnrichedPrompt) ──

function buildEnrichedPrompt(
  userPrompt: string,
  currentScript: string | undefined,
  libraryResult: LibraryCheckResult,
): string {
  const parts: string[] = [];

  parts.push('IMPORTANT - KEEP IT SIMPLE:');
  parts.push('- ONLY use features the user explicitly asked for');
  parts.push("- Don't add visuals, color, effects, or modulation unless requested");
  parts.push('- Default to basic volume levels and simple syntax');
  parts.push('');

  parts.push('SYNTAX REFERENCE (use only if requested):');
  parts.push('- Basic: loop audio/file OR oneshot audio/file every 2to5');
  parts.push('- Generate: loop gen descriptive prompt OR oneshot gen descriptive prompt every 2to5');
  parts.push('- Variables: let myvar 0.5 (define at top level, reference by name)');
  parts.push('- Movement: move walk OR move fly OR move fly x -10to10 y 0to15 z -10to5 speed 2');
  parts.push('- Trajectories: move spiral OR move orbit OR move lorenz OR move gen flying bird');
  parts.push('- Interpolation: goto(0and0.2 in 5) OR gobetween(1and2 in 10) OR interpolate(0and1 as incubic in 5)');
  parts.push('- Easing: insine, outsine, inquad, incubic, inoutcubic, inexpo, inback, inelastic, inbounce, etc.');
  parts.push('- Repeat: gobetween(0and1 in 5 for 3) OR interpolate(0and1 in 5 for ever)');
  parts.push('- Effects: delay/reverb/filter/distortion/eq (only if user asks for effects)');
  parts.push('- Groups: group ... endgroup (property inheritance, volume/pitch multiply)');
  parts.push('- Multi-clip: oneshot bird and rain and wind every 5');
  parts.push('- Trajectory gen blocks: gen mypath + prompt/duration/smoothing/ground/variation');
  parts.push('- Visuals: visual trail/sphere/cube (only if user asks for visuals)');
  parts.push('- Color: color red/blue/#hex/rgb + alpha (only if user asks for color)');
  parts.push('- Timing: start 5, end 30 fade 2, fadein 1, fadeout 2');
  parts.push('');

  if (libraryResult.availableSamples.length > 0) {
    parts.push('AVAILABLE SAMPLES FOR THIS REQUEST:');
    for (const s of libraryResult.availableSamples.slice(0, 10)) {
      parts.push(`  - ${s}`);
    }
    parts.push('');
  }

  if (libraryResult.missingSamples.length > 0) {
    parts.push('MISSING SAMPLES - USE gen KEYWORD TO GENERATE THESE:');
    for (const m of libraryResult.missingSamples) {
      parts.push(`  - ${m} → use gen (e.g. loop gen ${m} or oneshot gen ${m})`);
    }
    parts.push('Write a descriptive prompt after gen for best results.');
    parts.push('');
  }

  if (currentScript && currentScript.trim() && currentScript.trim() !== '# satie') {
    parts.push('CURRENT SCRIPT (this is what is currently playing — KEEP ALL OF IT):');
    parts.push(currentScript);
    parts.push('');
    parts.push('USER REQUEST:');
    parts.push(userPrompt);
    parts.push('');
    parts.push('CRITICAL: Output the COMPLETE script with the requested modification ADDED to the existing code above. Do NOT remove or replace existing statements unless the user explicitly asks to. Preserve everything that is already there.');
  } else {
    parts.push('USER REQUEST:');
    parts.push(userPrompt);
    parts.push('');
    parts.push('Generate Satie code for this request using correct syntax.');
  }

  return parts.join('\n');
}

// ── Compilation verifier (uses parser + Haiku repair) ──────

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

async function verifyAndRepair(
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

async function generateCode(
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

async function generateSampleSpec(
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

// ── React component ────────────────────────────────────────

export function AIPanel({
  onGenerate,
  onGenerateSample,
  onGenerateTrajectory,
  currentScript,
  loadedSamples = [],
  target,
  onTargetChange,
  onFeedbackCreated,
}: AIPanelProps) {
  const [prompts, setPrompts] = useState<string[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Generation history (Option A: linear stack)
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1); // -1 = current/new

  // RLHF: track ratings for the currently viewed history entry
  const [feedbackRatings, setFeedbackRatings] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [prompts]);

  const restoreHistory = useCallback((index: number) => {
    if (index < 0 || index >= history.length) return;

    // Mark the entry we're navigating AWAY from as undone
    if (historyIndex >= 0 && historyIndex !== index) {
      const prevEntry = history[historyIndex];
      if (prevEntry.feedbackId) {
        updateFeedback(prevEntry.feedbackId, { wasUndone: true });
      }
    }

    const entry = history[index];
    setHistoryIndex(index);
    if (entry.target === 'script' && /\b(loop|oneshot)\b/.test(entry.result)) {
      onGenerate(entry.result);
    }
  }, [history, historyIndex, onGenerate]);

  const sendPrompt = useCallback(async (prompt: string) => {
    if (!prompt.trim()) return;

    setPrompts(prev => [...prev, prompt]);
    setInput('');
    setStatus(null);
    setIsLoading(true);

    try {
      // Validate that a provider is available
      createProvider();
    } catch {
      setStatus('No AI provider configured. Add an API key in dashboard settings.');
      setIsLoading(false);
      return;
    }

    try {
      if (target === 'trajectory') {
        // Trajectory generation mode
        const provider = createProvider();
        const spec = await generateTrajectoryFromPrompt(provider, prompt);
        setStatus(`generating trajectory "${spec.name}"...`);

        if (onGenerateTrajectory) {
          onGenerateTrajectory(spec.name, spec.code);
        }

        const fb = createFeedbackEntry(prompt, `trajectory: ${spec.name}`, 'trajectory');
        saveFeedback(fb);

        const entry: HistoryEntry = {
          prompt,
          result: `trajectory: ${spec.name}`,
          timestamp: Date.now(),
          target: 'trajectory',
          feedbackId: fb.id,
        };
        setHistory(prev => {
          const truncated = historyIndex >= 0 ? prev.slice(0, historyIndex + 1) : prev;
          return [...truncated, entry];
        });
        setHistoryIndex(-1);
      } else if (target === 'sample') {
        // Sample generation mode
        const spec = await generateSampleSpec(prompt);
        setStatus(`generating "${spec.name}"...`);

        onGenerateSample(spec.name, spec.prompt);

        const fb = createFeedbackEntry(prompt, `sample: ${spec.name} (${spec.prompt})`, 'sample');
        saveFeedback(fb);

        const entry: HistoryEntry = {
          prompt,
          result: `sample: ${spec.name} (${spec.prompt})`,
          timestamp: Date.now(),
          target: 'sample',
          feedbackId: fb.id,
        };
        setHistory(prev => {
          const truncated = historyIndex >= 0 ? prev.slice(0, historyIndex + 1) : prev;
          return [...truncated, entry];
        });
        setHistoryIndex(-1);
      } else {
        // Script generation mode
        // Always pass currentScript as the source of truth — no stale conversation history.
        // Each request is self-contained: the enriched prompt includes the full current script.
        const result = await generateCode(
          prompt,
          currentScript,
          loadedSamples,
          [],
        );

        if (/\b(loop|oneshot)\b/.test(result.code)) {
          onGenerate(result.code);
        }

        if (result.error) {
          setStatus(`warning: ${result.error}`);
        }

        // Save feedback entry for RLHF
        const fb = createFeedbackEntry(prompt, result.code, 'script');
        saveFeedback(fb);
        onFeedbackCreated?.(fb.id, result.code);

        const entry: HistoryEntry = {
          prompt,
          result: result.code,
          timestamp: Date.now(),
          target: 'script',
          feedbackId: fb.id,
        };
        setHistory(prev => {
          const truncated = historyIndex >= 0 ? prev.slice(0, historyIndex + 1) : prev;
          return [...truncated, entry];
        });
        setHistoryIndex(-1);
      }
    } catch (e: any) {
      setStatus(`error: ${e.message}`);
    } finally {
      setIsLoading(false);
    }
  }, [prompts, onGenerate, onGenerateSample, currentScript, loadedSamples, target, history, historyIndex]);

  const send = useCallback(() => {
    sendPrompt(input.trim());
  }, [input, sendPrompt]);

  // ASR
  const handleTranscription = useCallback((text: string) => {
    sendPrompt(text);
  }, [sendPrompt]);

  const handleASRError = useCallback((msg: string) => {
    setStatus(`mic: ${msg}`);
  }, []);

  const asr = useASR(handleTranscription, handleASRError);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }, [send]);

  // RLHF rating handler
  const handleRate = useCallback((rating: 1 | -1) => {
    const idx = historyIndex >= 0 ? historyIndex : history.length - 1;
    if (idx < 0 || idx >= history.length) return;
    const entry = history[idx];
    if (!entry.feedbackId) return;

    const currentRating = feedbackRatings.get(entry.feedbackId) ?? 0;
    const newRating = currentRating === rating ? 0 : rating; // toggle off if same
    setFeedbackRatings(prev => new Map(prev).set(entry.feedbackId!, newRating));
    updateFeedback(entry.feedbackId, { rating: newRating });
  }, [history, historyIndex, feedbackRatings]);

  const targetBtnStyle = (active: boolean): React.CSSProperties => ({
    padding: '2px 8px',
    background: active ? '#1a1a1a' : 'none',
    color: active ? '#fff' : '#1a1a1a',
    border: '1px solid #1a1a1a',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: '9px',
    fontFamily: "'Inter', system-ui, sans-serif",
    fontWeight: 500,
    letterSpacing: '0.03em',
    transition: 'all 0.15s',
  });

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      fontFamily: "'Inter', system-ui, sans-serif",
    }}>
      {/* Target selector */}
      <div style={{
        display: 'flex',
        gap: '4px',
        padding: '0 14px 6px',
        alignItems: 'center',
        flexShrink: 0,
      }}>
        <button
          onClick={() => onTargetChange('script')}
          style={targetBtnStyle(target === 'script')}
        >
          Script
        </button>
        <button
          onClick={() => onTargetChange('sample')}
          style={targetBtnStyle(target === 'sample')}
        >
          Sample
        </button>
        <button
          onClick={() => onTargetChange('trajectory')}
          style={targetBtnStyle(target === 'trajectory')}
        >
          Trajectory
        </button>
        <select
          value={getPreferredProvider()}
          onChange={(e) => {
            setPreferredProvider(e.target.value as AIProviderType);
            // Force re-render
            setStatus(null);
          }}
          title="AI Provider"
          style={{
            fontSize: '8px',
            opacity: 0.4,
            marginLeft: 'auto',
            fontFamily: "'SF Mono', monospace",
            background: 'transparent',
            border: '1px solid #d0cdc4',
            borderRadius: 4,
            padding: '1px 4px',
            color: '#1a3a2a',
            cursor: 'pointer',
            outline: 'none',
          }}
        >
          <option value="anthropic">Claude</option>
          <option value="openai">OpenAI</option>
          <option value="gemini">Gemini</option>
        </select>
      </div>

      {/* Prompt log — only shows user prompts, no code output */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '0 14px',
          fontSize: '12px',
        }}
      >
        {prompts.length === 0 && !status && (
          <div style={{ opacity: 0.2, fontSize: '11px', padding: '4px 0' }}>
            {target === 'script'
              ? 'describe what you want to hear'
              : 'describe the sample you need'}
          </div>
        )}
        {prompts.map((p, i) => (
          <div key={i} style={{
            padding: '3px 0',
            color: '#1a3a2a',
            opacity: 0.4,
            fontSize: '11px',
            fontStyle: 'italic',
          }}>
            {p}
          </div>
        ))}
        {status && (
          <div style={{
            padding: '3px 0',
            color: status.startsWith('error') ? '#8b0000' : '#1a3a2a',
            opacity: 0.5,
            fontSize: '10px',
            fontFamily: "'SF Mono', monospace",
          }}>
            {status}
          </div>
        )}
        {asr.recording && (
          <div style={{ opacity: 0.4, fontSize: '11px', padding: '4px 0', color: '#8b0000' }}>recording...</div>
        )}
        {asr.transcribing && (
          <div style={{ opacity: 0.3, fontSize: '11px', padding: '4px 0' }}>transcribing...</div>
        )}
        {isLoading && (
          <div style={{ opacity: 0.2, fontSize: '11px', padding: '4px 0' }}>...</div>
        )}
      </div>

      {/* History navigation — shows prompt for the active entry */}
      {history.length > 0 && (
        <div style={{
          borderTop: '1px solid #e8e0d8',
          flexShrink: 0,
          padding: '4px 14px 2px',
        }}>
          {historyIndex >= 0 && (
            <div style={{
              fontSize: '10px',
              color: '#1a3a2a',
              opacity: 0.5,
              fontStyle: 'italic',
              padding: '0 0 3px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {history[historyIndex].prompt}
            </div>
          )}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
          }}>
            <button
              onClick={() => restoreHistory(historyIndex <= 0 ? 0 : (historyIndex < 0 ? history.length - 2 : historyIndex - 1))}
              disabled={history.length <= 1 || historyIndex === 0}
              style={{
                background: 'none',
                border: 'none',
                cursor: history.length <= 1 || historyIndex === 0 ? 'default' : 'pointer',
                opacity: history.length <= 1 || historyIndex === 0 ? 0.15 : 0.5,
                fontSize: '12px',
                color: '#1a3a2a',
                padding: '0 4px',
              }}
            >
              &lt;
            </button>
            <span style={{
              fontSize: '9px',
              opacity: 0.3,
              fontFamily: "'SF Mono', monospace",
              minWidth: '32px',
              textAlign: 'center',
            }}>
              {historyIndex < 0 ? history.length : historyIndex + 1}/{history.length}
            </span>
            <button
              onClick={() => {
                if (historyIndex >= 0 && historyIndex < history.length - 1) {
                  restoreHistory(historyIndex + 1);
                }
              }}
              disabled={historyIndex < 0 || historyIndex >= history.length - 1}
              style={{
                background: 'none',
                border: 'none',
                cursor: (historyIndex < 0 || historyIndex >= history.length - 1) ? 'default' : 'pointer',
                opacity: (historyIndex < 0 || historyIndex >= history.length - 1) ? 0.15 : 0.5,
                fontSize: '12px',
                color: '#1a3a2a',
                padding: '0 4px',
              }}
            >
              &gt;
            </button>

            {/* RLHF: Thumbs up / down */}
            {(() => {
              const idx = historyIndex >= 0 ? historyIndex : history.length - 1;
              const fid = idx >= 0 && idx < history.length ? history[idx].feedbackId : null;
              const currentRating = fid ? (feedbackRatings.get(fid) ?? 0) : 0;
              if (!fid) return null;
              return (
                <div style={{ display: 'flex', gap: '2px', marginLeft: '8px' }}>
                  <button
                    onClick={() => handleRate(1)}
                    title="Good generation"
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: '11px',
                      padding: '0 2px',
                      opacity: currentRating === 1 ? 1 : 0.25,
                      color: '#1a3a2a',
                      transition: 'opacity 0.15s',
                    }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill={currentRating === 1 ? '#1a3a2a' : 'none'} stroke="#1a3a2a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/>
                      <path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/>
                    </svg>
                  </button>
                  <button
                    onClick={() => handleRate(-1)}
                    title="Bad generation"
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: '11px',
                      padding: '0 2px',
                      opacity: currentRating === -1 ? 1 : 0.25,
                      color: '#8b0000',
                      transition: 'opacity 0.15s',
                    }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill={currentRating === -1 ? '#8b0000' : 'none'} stroke="#8b0000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10z"/>
                      <path d="M17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/>
                    </svg>
                  </button>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Input area */}
      <div style={{ padding: '6px 14px 10px', flexShrink: 0, display: 'flex', gap: '6px', alignItems: 'center' }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={target === 'script' ? 'make a rainstorm...' : target === 'sample' ? 'a warm pad sound...' : 'a bird that stops on branches...'}
          rows={2}
          style={{
            flex: 1,
            padding: '8px 10px',
            border: '1px solid #d0cdc4',
            borderRadius: 12,
            fontSize: '12px',
            fontFamily: "'Inter', system-ui, sans-serif",
            background: '#faf9f6',
            outline: 'none',
            resize: 'none',
            color: '#1a3a2a',
            lineHeight: 1.4,
          }}
        />
        {/* Push-to-talk mic button */}
        <button
          onMouseDown={asr.start}
          onMouseUp={asr.stop}
          onMouseLeave={asr.recording ? asr.stop : undefined}
          title={asr.recording ? 'Release to transcribe' : asr.transcribing ? 'Transcribing...' : 'Hold to speak'}
          disabled={isLoading || asr.transcribing}
          style={{
            width: 34,
            height: 34,
            background: asr.recording ? '#8b0000' : 'none',
            border: `1.5px solid ${asr.recording ? '#8b0000' : '#d0cdc4'}`,
            borderRadius: 10,
            cursor: isLoading || asr.transcribing ? 'default' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            opacity: isLoading || asr.transcribing ? 0.3 : asr.recording ? 1 : 0.5,
            transition: 'all 0.15s',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke={asr.recording ? '#faf9f6' : '#1a3a2a'} strokeWidth="1.3">
            <rect x="5" y="1" width="4" height="8" rx="2" strokeLinejoin="round"/>
            <path d="M3 7 C3 9.2 4.8 11 7 11 C9.2 11 11 9.2 11 7" strokeLinecap="round"/>
            <line x1="7" y1="11" x2="7" y2="13" strokeLinecap="round"/>
          </svg>
        </button>
      </div>
    </div>
  );
}
