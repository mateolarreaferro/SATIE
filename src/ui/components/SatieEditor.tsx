import { useRef, useCallback, useEffect } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import { parse, SatieSyntaxError } from '../../engine';

interface SatieEditorProps {
  value: string;
  onChange: (value: string) => void;
  onRun?: () => void;
  errors: string | null;
}

const SATIE_LANG_ID = 'satie';

// ── Property documentation for hover + autocomplete ─────────

interface PropDoc {
  label: string;
  detail: string;
  documentation: string;
  insertText?: string;
}

const PROPERTY_DOCS: PropDoc[] = [
  { label: 'volume', detail: 'number | range', documentation: 'Voice amplitude (0–1). Supports ranges like `0.3to0.8` and interpolation.' },
  { label: 'pitch', detail: 'number | range', documentation: 'Playback rate (1 = normal). `0.5` = one octave down, `2` = one octave up.' },
  { label: 'start', detail: 'seconds | range', documentation: 'When the voice starts playing (in seconds from the beginning).' },
  { label: 'end', detail: 'seconds | range', documentation: 'When the voice stops playing (absolute time in seconds).' },
  { label: 'duration', detail: 'seconds | range', documentation: 'How long the voice plays before stopping.' },
  { label: 'fade_in', detail: 'seconds | range', documentation: 'Fade-in time in seconds. Volume ramps from 0 to target.' },
  { label: 'fade_out', detail: 'seconds | range', documentation: 'Fade-out time in seconds when the voice stops.' },
  { label: 'move', detail: 'walk|fly|fixed|spiral|orbit|lorenz <area>', documentation: 'Spatial movement type.\n- `walk x1 z1 x2 z2` — ground plane\n- `fly x1 y1 z1 x2 y2 z2` — 3D volume\n- `spiral/orbit/lorenz` — trajectory curves\n- `fixed x y z` — stationary position' },
  { label: 'speed', detail: 'number | range', documentation: 'Movement speed for trajectories (Hz). Default: 0.3' },
  { label: 'noise', detail: '0–1', documentation: 'Trajectory noise amplitude. Adds organic jitter to movement paths.' },
  { label: 'color', detail: '#hex | name | r g b', documentation: 'Voice color in the viewport.\n- Hex: `#ff3300`\n- Named: `red`, `blue`, `cyan`\n- RGB: `0.8 0.2 0.1`\n- Supports interpolation per channel.' },
  { label: 'alpha', detail: '0–1', documentation: 'Voice opacity in the viewport. Supports interpolation.' },
  { label: 'visual', detail: 'sphere|cube|trail|none', documentation: 'Visual representation in the 3D viewport. Combine with `+`: `trail+sphere`.' },
  { label: 'background', detail: '#hex | name | grayscale', documentation: 'Set the viewport background color.\n- Hex: `background #1a1a2e`\n- Named: `background black`\n- Grayscale: `background 40`\n- RGB: `background 26,26,46`', insertText: 'background ' },
  { label: 'overlap', detail: 'flag', documentation: 'Allow overlapping retriggers (oneshot only).' },
  { label: 'persistent', detail: 'flag', documentation: 'Keep the voice alive even when it stops playing.' },
  { label: 'mute', detail: 'flag', documentation: 'Mute this voice (parsed but not played).' },
  { label: 'solo', detail: 'flag', documentation: 'Solo this voice (mute all others).' },
  { label: 'randomstart', detail: 'flag', documentation: 'Start playback at a random position in the audio file.', insertText: 'randomstart' },
  { label: 'loopable', detail: 'flag', documentation: 'Mark generated audio as loopable (crossfade-friendly).' },
  { label: 'reverb', detail: 'wet size damping', documentation: 'Convolution reverb.\n- `wet` 0–1 (dry/wet mix)\n- `size` 0–1 (room size)\n- `damping` 0–1 (high-frequency absorption)\nExample: `reverb 0.4 0.7 0.5`' },
  { label: 'delay', detail: 'wet time feedback [pingpong]', documentation: 'Delay effect.\n- `wet` 0–1\n- `time` seconds\n- `feedback` 0–1\n- `pingpong` (optional flag)\nExample: `delay 0.3 0.25 0.5 pingpong`' },
  { label: 'filter', detail: 'mode cutoff resonance [wet]', documentation: 'Audio filter.\nModes: `lowpass`, `highpass`, `bandpass`, `notch`, `peak`\nExample: `filter lowpass 800 2 0.8`' },
  { label: 'distortion', detail: 'mode drive [wet]', documentation: 'Distortion effect.\nModes: `softclip`, `hardclip`, `tanh`, `cubic`, `asymmetric`\nExample: `distortion softclip 4 0.6`' },
  { label: 'eq', detail: 'low mid high', documentation: '3-band EQ (dB).\n- `low` (320 Hz shelf)\n- `mid` (1 kHz peak)\n- `high` (3.2 kHz shelf)\nExample: `eq 3 -2 1`' },
];

const KEYWORD_DOCS: PropDoc[] = [
  { label: 'loop', detail: 'statement', documentation: 'Play an audio file in a continuous loop.\nSyntax: `loop clip.wav [every Ns]`', insertText: 'loop ' },
  { label: 'oneshot', detail: 'statement', documentation: 'Play an audio file once (or retrigger with `every`).\nSyntax: `oneshot clip.wav [every 2to4]`', insertText: 'oneshot ' },
  { label: 'let', detail: 'variable', documentation: 'Define a variable for reuse.\nSyntax: `let $name = value`', insertText: 'let $' },
  { label: 'group', detail: 'block', documentation: 'Group voices with shared properties.\nProperties set in the group are inherited by all children.', insertText: 'group\n  ' },
  { label: 'endgroup', detail: 'block', documentation: 'End a group block.' },
  { label: 'gen', detail: 'AI generation', documentation: 'Generate audio with AI (ElevenLabs).\nSyntax: `loop gen "a gentle rain sound"`', insertText: 'gen "' },
  { label: 'comment', detail: 'block comment', documentation: 'Start a block comment. Everything until `endcomment` is ignored.' },
  { label: 'endcomment', detail: 'block comment', documentation: 'End a block comment.' },
];

const EASING_NAMES = [
  'linear', 'insine', 'outsine', 'inoutsine',
  'inquad', 'outquad', 'inoutquad',
  'incubic', 'outcubic', 'inoutcubic',
  'inexpo', 'outexpo', 'inoutexpo',
];

const MOVEMENT_TYPES = ['walk', 'fly', 'fixed', 'spiral', 'orbit', 'lorenz'];
const VISUAL_TYPES = ['sphere', 'cube', 'trail', 'none'];
const FILTER_MODES = ['lowpass', 'highpass', 'bandpass', 'notch', 'peak'];
const DISTORTION_MODES = ['softclip', 'hardclip', 'tanh', 'cubic', 'asymmetric'];

// ── Monaco registration ──────────────────────────────────────

let languageRegistered = false;

function registerSatieLanguage(monaco: any) {
  if (languageRegistered) return;
  languageRegistered = true;

  monaco.languages.register({ id: SATIE_LANG_ID });

  monaco.languages.setMonarchTokensProvider(SATIE_LANG_ID, {
    tokenizer: {
      root: [
        [/#.*$/, 'comment'],
        [/\b(comment)\b/, { token: 'comment', next: '@blockComment' }],
        [/\b(loop|oneshot)\b/, 'keyword'],
        [/\b(let)\b/, 'keyword.let'],
        [/\b(group|endgroup)\b/, 'keyword.control'],
        [/\b(gen)\b/, 'keyword.gen'],
        [/\b(every)\b/, 'keyword.every'],
        [/\b(goto|gobetween|interpolate)\s*\(/, 'function'],
        [/\b(walk|fly|fixed)\b/, 'type.move'],
        [/\b(volume|pitch|start|end|duration|fade_in|fade_out|move|color|alpha|visual|overlap|persistent|mute|solo|randomstart|random_start|prompt|influence|loopable|background|bg)\b/, 'variable'],
        [/\b(reverb|delay|filter|distortion|eq)\b/, 'variable.dsp'],
        [/\b(wet|drywet|size|roomsize|damping|damp|time|feedback|pingpong|mode|cutoff|freq|resonance|drive|low|mid|high|speed)\b/, 'variable.param'],
        [/\b(lowpass|highpass|bandpass|notch|peak|softclip|hardclip|tanh|cubic|asymmetric)\b/, 'type.mode'],
        [/\b(linear|insine|outsine|inoutsine|inquad|outquad|inoutquad|incubic|outcubic|inoutcubic|inexpo|outexpo|inoutexpo)\b/, 'string.easing'],
        [/-?\d+\.?\d*to-?\d+\.?\d*/, 'number.range'],
        [/-?\d+\.?\d*/, 'number'],
        [/#[0-9A-Fa-f]{6}/, 'string.color'],
        [/\b(red|green|blue|white|black|yellow|cyan|magenta|gray|grey)\b/, 'string.color'],
        [/\b(and|in|as|for|ever)\b/, 'keyword.operator'],
        [/audio\/\S+/, 'string.path'],
      ],
      blockComment: [
        [/\b(endcomment)\b/, { token: 'comment', next: '@pop' }],
        [/.*/, 'comment'],
      ],
    },
  });

  monaco.editor.defineTheme('satie-light', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'keyword', foreground: '1a3a2a', fontStyle: 'bold' },
      { token: 'keyword.control', foreground: '1a3a2a', fontStyle: 'bold' },
      { token: 'keyword.let', foreground: '6a4a8a', fontStyle: 'bold' },
      { token: 'keyword.gen', foreground: '8b4513', fontStyle: 'italic' },
      { token: 'keyword.every', foreground: '2b5a3a' },
      { token: 'keyword.operator', foreground: '999999' },
      { token: 'variable', foreground: '4a7a5a' },
      { token: 'variable.dsp', foreground: '8b0000' },
      { token: 'variable.param', foreground: '8b0000' },
      { token: 'number', foreground: '2b2b8a' },
      { token: 'number.range', foreground: '2b2b8a', fontStyle: 'italic' },
      { token: 'function', foreground: '6a4a8a' },
      { token: 'type.move', foreground: '2b5a8a' },
      { token: 'type.mode', foreground: '2b5a8a' },
      { token: 'string.easing', foreground: '8a6a3a' },
      { token: 'string.path', foreground: '8a6a3a' },
      { token: 'string.color', foreground: '8b4513' },
      { token: 'comment', foreground: 'aaaaaa' },
    ],
    colors: {
      'editor.background': '#faf9f6',
      'editor.foreground': '#1a1a1a',
      'editor.lineHighlightBackground': '#f0efe8',
      'editorLineNumber.foreground': '#cccccc',
      'editorLineNumber.activeForeground': '#999999',
      'editor.selectionBackground': '#d4e8d0',
      'editorCursor.foreground': '#1a3a2a',
      'editorIndentGuide.background': '#e8e8e0',
    },
  });

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

      // Easing names (inside interpolation parens)
      if (/\b(goto|gobetween|interpolate)\s*\(/.test(textBefore)) {
        for (const e of EASING_NAMES) {
          suggestions.push({ label: e, kind: CK.Function, detail: 'easing curve', insertText: e, range });
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

      // Easing names
      if (EASING_NAMES.includes(token)) {
        return {
          range: {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn,
          },
          contents: [
            { value: `**${token}** — easing curve` },
            { value: 'Used inside `goto()`, `gobetween()`, or `interpolate()` to shape value transitions over time.' },
          ],
        };
      }

      return null;
    },
  });
}

// ── Editor component ─────────────────────────────────────────

export function SatieEditor({ value, onChange, onRun, errors }: SatieEditorProps) {
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);
  const onRunRef = useRef(onRun);
  onRunRef.current = onRun;
  const validateTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const handleMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    registerSatieLanguage(monaco);
    monaco.editor.setTheme('satie-light');

    // Cmd+Enter / Ctrl+Enter to run
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      onRunRef.current?.();
    });
  }, []);

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
        parse(value);
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
          // Generic error — try to extract line number from message
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
        theme="satie-light"
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
      {errors && (
        <div style={{
          padding: '6px 12px',
          color: '#8b0000',
          fontSize: '11px',
          fontFamily: "'SF Mono', monospace",
          borderTop: '1px solid #e8e0d8',
          background: '#fdf6f0',
        }}>
          {errors}
        </div>
      )}
    </div>
  );
}
