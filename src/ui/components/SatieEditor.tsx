import { useRef, useCallback, useEffect } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import { parseWithWarnings, SatieSyntaxError } from '../../engine';
import type { ParseWarning } from '../../engine';
import { useTheme } from '../theme/ThemeContext';
import { LIGHT, DARK, type MonacoTheme } from '../theme/tokens';

interface SatieEditorProps {
  value: string;
  onChange: (value: string) => void;
  onRun?: () => void;
  errors: string | null;
  /** Runtime warnings from the engine (missing samples, generation failures, etc.) */
  runtimeWarnings?: string[];
  /** Community sample names for autocomplete suggestions after gen keyword */
  communitySamples?: string[];
}

const SATIE_LANG_ID = 'satie';

/** Module-level ref for community sample names — updated by SatieEditor component. */
let _communitySampleNames: string[] = [];

// ── Property documentation for hover + autocomplete ─────────

interface PropDoc {
  label: string;
  detail: string;
  documentation: string;
  insertText?: string;
}

const PROPERTY_DOCS: PropDoc[] = [
  { label: 'volume', detail: '0–1 | range', documentation: 'Voice amplitude (0–1). Supports ranges like `0.3to0.8` and interpolation.\nExample: `volume 0.7` or `volume fade 0 1 every 2`' },
  { label: 'pitch', detail: '0.1–4 | range', documentation: 'Playback rate (1 = normal). `0.5` = one octave down, `2` = one octave up.\nExample: `pitch 1.2` or `pitch fade 0.8 1.2 every 3 loop bounce`' },
  { label: 'start', detail: 'seconds | range', documentation: 'When the voice starts playing (in seconds from the beginning).\nExample: `start 2` or `start 0to5`' },
  { label: 'end', detail: 'seconds | range', documentation: 'When the voice stops playing (absolute time in seconds).\nExample: `end 10` or `end 10 fade 2`' },
  { label: 'duration', detail: 'seconds | range', documentation: 'How long the voice plays before stopping.\nExample: `duration 5` or `duration 3to8`' },
  { label: 'fade_in', detail: 'seconds | range', documentation: 'Fade-in time in seconds. Volume ramps from 0 to target.\nExample: `fade_in 1.5`' },
  { label: 'fade_out', detail: 'seconds | range', documentation: 'Fade-out time in seconds when the voice stops.\nExample: `fade_out 2`' },
  { label: 'move', detail: 'walk|fly|fixed|spiral|orbit|lorenz <area>', documentation: 'Spatial movement type.\n- `walk x1 z1 x2 z2` — ground plane\n- `fly x1 y1 z1 x2 y2 z2` — 3D volume\n- `spiral/orbit/lorenz` — trajectory curves\n- `fixed x y z` — stationary position\nExample: `move fly -5 -3 -5 5 3 5`' },
  { label: 'speed', detail: '0.01–10 | range', documentation: 'Movement speed for trajectories (Hz). Default: 0.3\nExample: `speed 0.5`' },
  { label: 'noise', detail: '0–1', documentation: 'Trajectory noise amplitude. Adds organic jitter to movement paths.\nExample: `noise 0.3`' },
  { label: 'color', detail: '#hex | name | r g b', documentation: 'Voice color in the viewport.\n- Hex: `#ff3300`\n- Named: `red`, `blue`, `cyan`\n- RGB: `0.8 0.2 0.1`\n- Supports interpolation per channel.' },
  { label: 'alpha', detail: '0–1', documentation: 'Voice opacity in the viewport. Supports interpolation.\nExample: `alpha 0.5` or `alpha fade 0 1 every 3`' },
  { label: 'visual', detail: 'sphere|cube|trail|none [size N]', documentation: 'Visual representation in the 3D viewport.\nCombine types: `visual trail sphere`, `visual cube size 2`\nValid tokens: trail, sphere, cube, none' },
  { label: 'background', detail: '#hex | name | grayscale', documentation: 'Set the viewport background color.\n- Hex: `background #1a1a2e`\n- Named: `background black`\n- Grayscale: `background 40`\n- RGB: `background 26,26,46`', insertText: 'background ' },
  { label: 'overlap', detail: 'flag', documentation: 'Allow overlapping retriggers (oneshot only).' },
  { label: 'persistent', detail: 'flag', documentation: 'Keep the voice alive even when it stops playing.' },
  { label: 'mute', detail: 'flag', documentation: 'Mute this voice (parsed but not played).' },
  { label: 'solo', detail: 'flag', documentation: 'Solo this voice (mute all others).' },
  { label: 'randomstart', detail: 'flag', documentation: 'Start playback at a random position in the audio file.', insertText: 'randomstart' },
  { label: 'loopable', detail: 'flag', documentation: 'Mark generated audio as loopable (crossfade-friendly).' },
  { label: 'reverb', detail: 'wet size damping', documentation: 'Convolution reverb.\n- `wet` 0–1 (dry/wet mix)\n- `size` 0–1 (room size)\n- `damping` 0–1 (high-frequency absorption)\nExample: `reverb 0.4 0.7 0.5`' },
  { label: 'delay', detail: 'wet time feedback [pingpong]', documentation: 'Delay effect.\n- `wet` 0–1\n- `time` seconds\n- `feedback` 0–1\n- `pingpong` (optional flag)\nExample: `delay 0.3 0.25 0.5 pingpong`' },
  { label: 'filter', detail: 'type cutoff resonance [wet]', documentation: 'Audio filter.\nTypes: `lowpass`, `highpass`, `bandpass`, `notch`, `peak`\nExample: `filter lowpass cutoff 800 resonance 2`' },
  { label: 'distortion', detail: 'type drive [wet]', documentation: 'Distortion effect.\nTypes: `softclip`, `hardclip`, `tanh`, `cubic`, `asymmetric`\nExample: `distortion softclip drive 4`' },
  { label: 'eq', detail: 'low mid high', documentation: '3-band EQ (dB).\n- `low` (320 Hz shelf)\n- `mid` (1 kHz peak)\n- `high` (3.2 kHz shelf)\nExample: `eq 3 -2 1`' },
];

const KEYWORD_DOCS: PropDoc[] = [
  { label: 'loop', detail: 'statement', documentation: 'Play an audio file in a continuous loop.\nSyntax: `loop clip.wav [every Ns]`', insertText: 'loop ' },
  { label: 'oneshot', detail: 'statement', documentation: 'Play an audio file once (or retrigger with `every`).\nSyntax: `oneshot clip.wav [every 2to4]`', insertText: 'oneshot ' },
  { label: 'let', detail: 'variable', documentation: 'Define a variable for reuse.\nSyntax: `let $name = value`', insertText: 'let $' },
  { label: 'group', detail: 'block', documentation: 'Group voices with shared properties.\nProperties set in the group are inherited by all children.', insertText: 'group\n  ' },
  { label: 'endgroup', detail: 'block', documentation: 'End a group block.' },
  { label: 'gen', detail: 'AI generation', documentation: 'Generate audio with AI (ElevenLabs).\nSyntax: `loop gen "a gentle rain sound"`', insertText: 'gen "' },
  { label: 'fade', detail: 'continuous modulation', documentation: 'Smoothly transition between values.\nSyntax: `fade 0 1 every 2`\nWith loop: `fade 0.2 0.8 every 3 loop bounce`', insertText: 'fade ' },
  { label: 'jump', detail: 'discrete modulation', documentation: 'Step between values.\nSyntax: `jump 0.1 0.5 1 every 2`\nWith loop: `jump 1 2 3 every 5 loop restart`', insertText: 'jump ' },
  { label: 'comment', detail: 'block comment', documentation: 'Start a block comment. Everything until `endcomment` is ignored.' },
  { label: 'endcomment', detail: 'block comment', documentation: 'End a block comment.' },
];

const LOOP_MODES = ['bounce', 'restart'];

const MOVEMENT_TYPES = ['walk', 'fly', 'fixed', 'spiral', 'orbit', 'lorenz'];
const VISUAL_TYPES = ['sphere', 'cube', 'trail', 'none'];
const FILTER_MODES = ['lowpass', 'highpass', 'bandpass', 'notch', 'peak'];
const DISTORTION_MODES = ['softclip', 'hardclip', 'tanh', 'cubic', 'asymmetric'];

// ── Monaco registration ──────────────────────────────────────

let languageRegistered = false;

/** Strip a leading '#' so Monaco's `foreground` field (no '#') is happy. */
function rgb(hex: string): string {
  return hex.startsWith('#') ? hex.slice(1) : hex;
}

/** Register a Monaco theme using a MonacoTheme token block. */
function defineMonacoTheme(
  monaco: any,
  name: string,
  base: 'vs' | 'vs-dark',
  m: MonacoTheme,
) {
  monaco.editor.defineTheme(name, {
    base,
    inherit: true,
    rules: [
      { token: 'keyword', foreground: rgb(m.tokens.keyword), fontStyle: 'bold' },
      { token: 'keyword.control', foreground: rgb(m.tokens.keyword), fontStyle: 'bold' },
      { token: 'keyword.let', foreground: rgb(m.tokens.keywordLet), fontStyle: 'bold' },
      { token: 'keyword.gen', foreground: rgb(m.tokens.keywordGen), fontStyle: 'italic' },
      { token: 'keyword.every', foreground: rgb(m.tokens.keywordEvery) },
      { token: 'keyword.operator', foreground: rgb(m.tokens.keywordOperator) },
      { token: 'variable', foreground: rgb(m.tokens.variable) },
      { token: 'variable.dsp', foreground: rgb(m.tokens.variableDsp) },
      { token: 'variable.param', foreground: rgb(m.tokens.variableParam) },
      { token: 'number', foreground: rgb(m.tokens.number) },
      { token: 'number.range', foreground: rgb(m.tokens.numberRange), fontStyle: 'italic' },
      { token: 'function', foreground: rgb(m.tokens.function) },
      { token: 'type.move', foreground: rgb(m.tokens.typeMove) },
      { token: 'type.mode', foreground: rgb(m.tokens.typeMode) },
      { token: 'string.easing', foreground: rgb(m.tokens.stringEasing) },
      { token: 'string.path', foreground: rgb(m.tokens.stringPath) },
      { token: 'string.color', foreground: rgb(m.tokens.stringColor) },
      { token: 'comment', foreground: rgb(m.tokens.comment) },
    ],
    colors: {
      'editor.background': m.background,
      'editor.foreground': m.foreground,
      'editor.lineHighlightBackground': m.lineHighlight,
      'editorLineNumber.foreground': m.lineNumber,
      'editorLineNumber.activeForeground': m.lineNumberActive,
      'editor.selectionBackground': m.selection,
      'editorCursor.foreground': m.cursor,
      'editorIndentGuide.background': m.indentGuide,
    },
  });
}

export function registerSatieLanguage(monaco: any) {
  if (languageRegistered) return;
  languageRegistered = true;

  monaco.languages.register({ id: SATIE_LANG_ID });

  monaco.languages.setMonarchTokensProvider(SATIE_LANG_ID, {
    tokenizer: {
      root: [
        [/^-.*$/, 'comment'],
        [/\s+-\s+(?!\d).*$/, 'comment'],
        [/\b(comment)\b/, { token: 'comment', next: '@blockComment' }],
        [/\b(loop|oneshot)\b/, 'keyword'],
        [/\b(let)\b/, 'keyword.let'],
        [/\b(group|endgroup)\b/, 'keyword.control'],
        [/\b(gen)\b/, 'keyword.gen'],
        [/\b(every)\b/, 'keyword.every'],
        [/\b(fade|jump)\b/, 'function'],
        [/\b(walk|fly|fixed)\b/, 'type.move'],
        [/\b(volume|pitch|start|end|duration|fade_in|fade_out|move|color|alpha|visual|overlap|persistent|mute|solo|randomstart|random_start|prompt|influence|loopable|background|bg|size)\b/, 'variable'],
        [/\b(reverb|delay|filter|distortion|eq)\b/, 'variable.dsp'],
        [/\b(wet|drywet|roomsize|damping|damp|time|feedback|pingpong|cutoff|freq|resonance|drive|low|mid|high|speed)\b/, 'variable.param'],
        [/\b(lowpass|highpass|bandpass|notch|peak|softclip|hardclip|tanh|cubic|asymmetric)\b/, 'type.mode'],
        [/\b(bounce|restart)\b/, 'type.mode'],
        [/-?\d+\.?\d*to-?\d+\.?\d*/, 'number.range'],
        [/-?\d+\.?\d*/, 'number'],
        [/#[0-9A-Fa-f]{6}/, 'string.color'],
        [/\b(red|green|blue|white|black|yellow|cyan|magenta|gray|grey)\b/, 'string.color'],
        [/\b(and|loop)\b/, 'keyword.operator'],
        [/audio\/\S+/, 'string.path'],
      ],
      blockComment: [
        [/\b(endcomment)\b/, { token: 'comment', next: '@pop' }],
        [/.*/, 'comment'],
      ],
    },
  });

  // Themes are sourced from the design tokens (theme.monaco) so editor theming
  // stays in lockstep with the rest of the design system.
  defineMonacoTheme(monaco, 'satie-light', 'vs', LIGHT.monaco);
  defineMonacoTheme(monaco, 'satie-dark', 'vs-dark', DARK.monaco);

  // ── Completion provider ──────────────────────────────────

  monaco.languages.registerCompletionItemProvider(SATIE_LANG_ID, {
    triggerCharacters: [' ', '\n'],
    provideCompletionItems: (model: any, position: any) => {
      const line = model.getLineContent(position.lineNumber);
      const textBefore = line.substring(0, position.column - 1).trimStart();
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      const suggestions: any[] = [];
      const CK = monaco.languages.CompletionItemKind;

      // Top-level: keywords
      if (textBefore === '' || /^(loop|oneshot|let|group|endgroup|comment|endcomment|gen)/.test(textBefore) === false) {
        for (const kw of KEYWORD_DOCS) {
          suggestions.push({
            label: kw.label,
            kind: CK.Keyword,
            detail: kw.detail,
            documentation: kw.documentation,
            insertText: kw.insertText ?? kw.label,
            range,
          });
        }
      }

      // Indented: properties
      if (/^\s+/.test(line)) {
        for (const p of PROPERTY_DOCS) {
          suggestions.push({
            label: p.label,
            kind: CK.Property,
            detail: p.detail,
            documentation: p.documentation,
            insertText: p.insertText ?? p.label + ' ',
            range,
          });
        }
      }

      // After 'move': movement types
      if (/\bmove\s+\S*$/.test(textBefore)) {
        for (const m of MOVEMENT_TYPES) {
          suggestions.push({ label: m, kind: CK.Enum, detail: 'movement type', insertText: m + ' ', range });
        }
      }

      // After 'visual': visual types
      if (/\bvisual\s+\S*$/.test(textBefore)) {
        for (const v of VISUAL_TYPES) {
          suggestions.push({ label: v, kind: CK.Enum, detail: 'visual type', insertText: v, range });
        }
      }

      // After 'filter': filter modes
      if (/\bfilter\s+\S*$/.test(textBefore)) {
        for (const f of FILTER_MODES) {
          suggestions.push({ label: f, kind: CK.Enum, detail: 'filter mode', insertText: f + ' ', range });
        }
      }

      // After 'distortion': distortion modes
      if (/\bdistortion\s+\S*$/.test(textBefore)) {
        for (const d of DISTORTION_MODES) {
          suggestions.push({ label: d, kind: CK.Enum, detail: 'distortion mode', insertText: d + ' ', range });
        }
      }

      // Loop modes (after 'loop' keyword in fade/jump)
      if (/\bloop\s+\S*$/.test(textBefore)) {
        for (const m of LOOP_MODES) {
          suggestions.push({ label: m, kind: CK.Enum, detail: 'loop mode', insertText: m, range });
        }
      }

      // After 'gen': suggest community samples as alternatives
      if (/\bgen\s+/.test(textBefore) && _communitySampleNames.length > 0) {
        const typed = textBefore.replace(/^.*\bgen\s+/, '').toLowerCase();
        for (const name of _communitySampleNames) {
          if (!typed || name.toLowerCase().includes(typed)) {
            suggestions.push({
              label: `community/${name}`,
              kind: CK.File,
              detail: 'community sample',
              documentation: `Use shared community sample "${name}" instead of generating audio.`,
              insertText: `community/${name}`,
              range,
              sortText: '0' + name, // sort community samples first
            });
          }
        }
      }

      return { suggestions };
    },
  });

  // ── Hover provider ───────────────────────────────────────

  monaco.languages.registerHoverProvider(SATIE_LANG_ID, {
    provideHover: (model: any, position: any) => {
      const word = model.getWordAtPosition(position);
      if (!word) return null;

      const token = word.word.toLowerCase();

      // Search in all doc sources
      const allDocs = [...PROPERTY_DOCS, ...KEYWORD_DOCS];
      const match = allDocs.find(d => d.label === token);
      if (match) {
        return {
          range: {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn,
          },
          contents: [
            { value: `**${match.label}** — ${match.detail}` },
            { value: match.documentation },
          ],
        };
      }

      // Loop modes
      if (LOOP_MODES.includes(token)) {
        return {
          range: {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn,
          },
          contents: [
            { value: `**${token}** — loop mode` },
            { value: token === 'bounce' ? 'Oscillate back and forth through values.' : 'Loop back to the first value after reaching the last.' },
          ],
        };
      }

      return null;
    },
  });
}

// ── Editor component ─────────────────────────────────────────

export function SatieEditor({ value, onChange, onRun, errors, runtimeWarnings, communitySamples }: SatieEditorProps) {
  // Keep module-level ref in sync with prop for completion provider
  _communitySampleNames = communitySamples ?? [];
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);
  const onRunRef = useRef(onRun);
  onRunRef.current = onRun;
  const validateTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const { resolvedMode } = useTheme();
  const themeName = resolvedMode === 'dark' ? 'satie-dark' : 'satie-light';

  const handleMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    registerSatieLanguage(monaco);
    monaco.editor.setTheme(themeName);

    // Cmd+Enter / Ctrl+Enter to run
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      onRunRef.current?.();
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Switch the active Monaco theme when the app theme changes.
  useEffect(() => {
    if (!monacoRef.current) return;
    monacoRef.current.editor.setTheme(themeName);
  }, [themeName]);

  // ── Live validation (debounced) ────────────────────────────

  useEffect(() => {
    if (!monacoRef.current || !editorRef.current) return;
    if (validateTimer.current) clearTimeout(validateTimer.current);

    validateTimer.current = setTimeout(() => {
      const monaco = monacoRef.current;
      const model = editorRef.current.getModel();
      if (!model) return;

      const markers: any[] = [];

      try {
        const result = parseWithWarnings(value);

        // Add warnings as yellow markers
        for (const w of result.warnings) {
          const lineNum = w.lineNumber > 0
            ? Math.min(w.lineNumber, model.getLineCount())
            : 1;
          markers.push({
            severity: w.severity === 'info'
              ? monaco.MarkerSeverity.Info
              : monaco.MarkerSeverity.Warning,
            message: w.message,
            startLineNumber: lineNum,
            endLineNumber: lineNum,
            startColumn: 1,
            endColumn: model.getLineMaxColumn(lineNum),
          });
        }
      } catch (e: any) {
        if (e instanceof SatieSyntaxError && e.lineNumber >= 0) {
          markers.push({
            severity: monaco.MarkerSeverity.Error,
            message: e.message,
            startLineNumber: e.lineNumber,
            endLineNumber: e.lineNumber,
            startColumn: 1,
            endColumn: model.getLineMaxColumn(Math.min(e.lineNumber, model.getLineCount())),
          });
        } else if (e.message) {
          const lineMatch = e.message.match(/line\s+(\d+)/i);
          const lineNum = lineMatch ? parseInt(lineMatch[1]) : 1;
          markers.push({
            severity: monaco.MarkerSeverity.Error,
            message: e.message,
            startLineNumber: lineNum,
            endLineNumber: lineNum,
            startColumn: 1,
            endColumn: model.getLineMaxColumn(Math.min(lineNum, model.getLineCount())),
          });
        }
      }

      monaco.editor.setModelMarkers(model, 'satie', markers);
    }, 400);

    return () => { if (validateTimer.current) clearTimeout(validateTimer.current); };
  }, [value]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Editor
        height="100%"
        language={SATIE_LANG_ID}
        theme={themeName}
        value={value}
        onChange={(v) => onChange(v ?? '')}
        onMount={handleMount}
        options={{
          fontSize: 13,
          fontFamily: "'SF Mono', 'Fira Code', 'Consolas', monospace",
          minimap: { enabled: false },
          lineNumbers: 'on',
          wordWrap: 'on',
          scrollBeyondLastLine: false,
          tabSize: 2,
          renderWhitespace: 'none',
          bracketPairColorization: { enabled: false },
          padding: { top: 8 },
          scrollbar: { vertical: 'hidden', horizontal: 'hidden' },
          overviewRulerBorder: false,
          overviewRulerLanes: 0,
          hideCursorInOverviewRuler: true,
          renderLineHighlight: 'line',
          lineDecorationsWidth: 8,
          lineNumbersMinChars: 3,
          glyphMargin: false,
          folding: false,
          quickSuggestions: { other: true, comments: false, strings: false },
          suggestOnTriggerCharacters: true,
        }}
      />
      {/* Syntax errors */}
      {errors && (
        <div style={{
          padding: '6px 12px',
          color: '#8b0000',
          fontSize: '16px',
          fontFamily: "'SF Mono', monospace",
          borderTop: '1px solid #e8e0d8',
          background: '#fdf6f0',
        }}>
          {errors}
        </div>
      )}
      {/* Runtime warnings (missing samples, generation failures, etc.) */}
      {runtimeWarnings && runtimeWarnings.length > 0 && (
        <div style={{
          padding: '6px 12px',
          color: '#8b6914',
          fontSize: '15px',
          fontFamily: "'SF Mono', monospace",
          borderTop: '1px solid #e8e0d8',
          background: '#fefbf0',
          maxHeight: 60,
          overflow: 'auto',
        }}>
          {runtimeWarnings.map((w, i) => (
            <div key={i} style={{ opacity: 0.85 }}>{w}</div>
          ))}
        </div>
      )}
    </div>
  );
}
