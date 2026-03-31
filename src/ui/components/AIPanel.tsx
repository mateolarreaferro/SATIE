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

// ── System prompt — compositional intelligence ──────────────

function buildSystemPrompt(
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
      reverb 0.4 0.7 0.5
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

COLOR & VISUALS (use only when requested):
  color #FF5733 | color red | color red 200 green 100 blue 50
  alpha 0.5
  visual sphere | visual trail | visual trail cube

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

${audioLibrary}
${topExamples.length > 0 ? `
PROVEN PATTERNS (user-approved — follow these):
${topExamples.map((ex, i) => `${i + 1}. "${ex.prompt}" →\n${(ex.userEditedOutput ?? ex.output).slice(0, 400)}`).join('\n\n')}` : ''}
${antiPatterns.length > 0 ? `
REJECTED PATTERNS (avoid):
${antiPatterns.map((ex, i) => `${i + 1}. "${ex.prompt}" → rejected:\n${ex.output.slice(0, 200)}`).join('\n\n')}` : ''}`;
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

// ── Enriched prompt — compositional context ─────────────────

function buildEnrichedPrompt(
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
        // Build lightweight conversation context from recent history (last 3 exchanges)
        const recentHistory = history
          .filter(h => h.target === 'script')
          .slice(-3)
          .flatMap(h => [
            { role: 'user', content: h.prompt },
            { role: 'assistant', content: h.result },
          ]);

        const result = await generateCode(
          prompt,
          currentScript,
          loadedSamples,
          recentHistory,
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
