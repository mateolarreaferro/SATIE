import { useMemo } from 'react';

type TokenType =
  | 'keyword'
  | 'keyword.control'
  | 'keyword.let'
  | 'keyword.gen'
  | 'keyword.every'
  | 'keyword.operator'
  | 'function'
  | 'variable'
  | 'variable.dsp'
  | 'variable.param'
  | 'number'
  | 'number.range'
  | 'type.move'
  | 'type.mode'
  | 'string.color'
  | 'string.path'
  | 'comment'
  | 'text';

// Mirrors the color palette defined in SatieEditor.tsx (satie-light theme)
const TOKEN_COLORS: Record<TokenType, { color: string; fontStyle?: string; fontWeight?: number }> = {
  keyword:            { color: '#1a3a2a', fontWeight: 700 },
  'keyword.control':  { color: '#1a3a2a', fontWeight: 700 },
  'keyword.let':      { color: '#6a4a8a', fontWeight: 700 },
  'keyword.gen':      { color: '#8b4513', fontStyle: 'italic' },
  'keyword.every':    { color: '#2b5a3a' },
  'keyword.operator': { color: '#999999' },
  function:           { color: '#6a4a8a' },
  variable:           { color: '#4a7a5a' },
  'variable.dsp':     { color: '#8b0000' },
  'variable.param':   { color: '#8b0000' },
  number:             { color: '#2b2b8a' },
  'number.range':     { color: '#2b2b8a', fontStyle: 'italic' },
  'type.move':        { color: '#2b5a8a' },
  'type.mode':        { color: '#2b5a8a' },
  'string.color':     { color: '#8b4513' },
  'string.path':      { color: '#8a6a3a' },
  comment:            { color: '#aaaaaa' },
  text:               { color: '#1a1a1a' },
};

const KEYWORDS = new Set(['loop', 'oneshot']);
const KEYWORD_CONTROL = new Set(['group', 'endgroup', 'comment', 'endcomment']);
const PROPERTIES = new Set([
  'volume', 'pitch', 'start', 'end', 'duration', 'fade_in', 'fade_out',
  'move', 'color', 'alpha', 'visual', 'overlap', 'persistent', 'mute',
  'solo', 'randomstart', 'random_start', 'prompt', 'influence', 'loopable',
  'background', 'bg', 'size', 'noise',
]);
const DSP_EFFECTS = new Set(['reverb', 'delay', 'filter', 'distortion', 'eq']);
const DSP_PARAMS = new Set([
  'wet', 'drywet', 'roomsize', 'damping', 'damp', 'time', 'feedback',
  'pingpong', 'cutoff', 'freq', 'resonance', 'drive', 'low', 'mid', 'high', 'speed',
]);
const MOVE_TYPES = new Set(['walk', 'fly', 'fixed']);
const FILTER_MODES = new Set(['lowpass', 'highpass', 'bandpass', 'notch', 'peak']);
const DISTORTION_MODES = new Set(['softclip', 'hardclip', 'tanh', 'cubic', 'asymmetric']);
const LOOP_MODES = new Set(['bounce', 'restart']);
const NAMED_COLORS = new Set(['red', 'green', 'blue', 'white', 'black', 'yellow', 'cyan', 'magenta', 'gray', 'grey']);

function classifyWord(word: string): TokenType | null {
  const lw = word.toLowerCase();
  if (KEYWORDS.has(lw)) return 'keyword';
  if (KEYWORD_CONTROL.has(lw)) return 'keyword.control';
  if (lw === 'let') return 'keyword.let';
  if (lw === 'gen') return 'keyword.gen';
  if (lw === 'every') return 'keyword.every';
  if (lw === 'and') return 'keyword.operator';
  if (lw === 'fade' || lw === 'jump') return 'function';
  if (MOVE_TYPES.has(lw)) return 'type.move';
  if (FILTER_MODES.has(lw) || DISTORTION_MODES.has(lw) || LOOP_MODES.has(lw)) return 'type.mode';
  if (DSP_EFFECTS.has(lw)) return 'variable.dsp';
  if (DSP_PARAMS.has(lw)) return 'variable.param';
  if (PROPERTIES.has(lw)) return 'variable';
  if (NAMED_COLORS.has(lw)) return 'string.color';
  return null;
}

interface Token {
  text: string;
  type: TokenType;
}

function tokenizeLine(line: string): Token[] {
  // Whole-line comments: `-` or `#` at the start (after optional whitespace)
  if (/^\s*[-#]/.test(line)) {
    return [{ text: line, type: 'comment' }];
  }

  const tokens: Token[] = [];
  const re = /(\s+)|(#[0-9A-Fa-f]{6})|(audio\/\S+|community\/\S+)|(-?\d+\.?\d*to-?\d+\.?\d*)|(-?\d+\.?\d*)|([A-Za-z_][A-Za-z0-9_]*)|("[^"]*")|(\$[A-Za-z_][A-Za-z0-9_]*)|(.)/g;

  let match: RegExpExecArray | null;
  while ((match = re.exec(line)) !== null) {
    const [, ws, hex, path, range, num, word, str, variable, other] = match;
    if (ws) {
      tokens.push({ text: ws, type: 'text' });
    } else if (hex) {
      tokens.push({ text: hex, type: 'string.color' });
    } else if (path) {
      tokens.push({ text: path, type: 'string.path' });
    } else if (range) {
      tokens.push({ text: range, type: 'number.range' });
    } else if (num) {
      tokens.push({ text: num, type: 'number' });
    } else if (word) {
      const classified = classifyWord(word);
      tokens.push({ text: word, type: classified ?? 'text' });
    } else if (str) {
      tokens.push({ text: str, type: 'string.path' });
    } else if (variable) {
      tokens.push({ text: variable, type: 'keyword.let' });
    } else if (other) {
      tokens.push({ text: other, type: 'text' });
    }
  }
  return tokens;
}

export function SatieScriptViewer({ script, style }: { script: string; style?: React.CSSProperties }) {
  const lines = useMemo(() => {
    const out: Token[][] = [];
    let inBlockComment = false;
    for (const line of script.split('\n')) {
      const trimmed = line.trim().toLowerCase();
      if (inBlockComment) {
        out.push([{ text: line, type: 'comment' }]);
        if (trimmed === 'endcomment') inBlockComment = false;
        continue;
      }
      if (trimmed === 'comment') {
        inBlockComment = true;
        out.push([{ text: line, type: 'comment' }]);
        continue;
      }
      out.push(tokenizeLine(line));
    }
    return out;
  }, [script]);

  return (
    <pre style={style}>
      {lines.map((tokens, i) => (
        <div key={i}>
          {tokens.length === 0 ? ' ' : tokens.map((tk, j) => {
            const s = TOKEN_COLORS[tk.type];
            return (
              <span key={j} style={{ color: s.color, fontStyle: s.fontStyle, fontWeight: s.fontWeight }}>
                {tk.text}
              </span>
            );
          })}
        </div>
      ))}
    </pre>
  );
}
