/**
 * Satie design tokens.
 *
 * Single source of truth for theme colors, spacing, radii, shadows, and typography.
 * Imported by `useDayNightCycle` (the runtime hook), `ThemeContext` (the provider),
 * and primitive components in `src/ui/components/primitives/`.
 *
 * Project palette anchors (preserved exactly in light theme):
 *   bg #f4f3ee · text #0a0a0a · accent #1a3a2a · danger #8b0000
 */

export type ThemeMode = 'light' | 'dark' | 'fade' | 'system';

/** Monaco editor token colors — keys mirror the rule tokens used in SatieEditor. */
export interface MonacoTokens {
  keyword: string;
  keywordLet: string;
  keywordGen: string;
  keywordEvery: string;
  keywordOperator: string;
  variable: string;
  variableDsp: string;
  variableParam: string;
  number: string;
  numberRange: string;
  function: string;
  typeMove: string;
  typeMode: string;
  stringEasing: string;
  stringPath: string;
  stringColor: string;
  comment: string;
}

export interface MonacoTheme {
  background: string;
  foreground: string;
  lineHighlight: string;
  lineNumber: string;
  lineNumberActive: string;
  selection: string;
  cursor: string;
  indentGuide: string;
  tokens: MonacoTokens;
}

/**
 * Theme contract used by every primitive and consumer.
 *
 * Note: `mode` is one of the *resolved* runtime modes; `system` is collapsed by
 * `useTheme()` into `light` / `dark` based on `prefers-color-scheme`. The hook
 * always emits one of `'light' | 'dark' | 'fade'` here for backward compat.
 */
export interface Theme {
  // Existing fields (kept identical to legacy shape) ──────────
  bg: string;
  text: string;
  textMuted: string;
  border: string;
  cardBg: string;
  cardBorder: string;
  invertedBg: string;
  invertedText: string;
  mode: 'light' | 'dark' | 'fade';

  // New tokens ────────────────────────────────────────────────
  /** Primary brand accent — used for emphasis, primary buttons, focus. */
  accent: string;
  /** Foreground color when painted on top of `accent`. */
  accentText: string;
  /** Subtle accent-tinted surface, e.g. selected list rows / hover backgrounds. */
  accentBgSubtle: string;
  /** Destructive red. */
  danger: string;
  /** Warning amber. */
  warn: string;
  /** Sunken surface, deeper than `cardBg`. */
  cardBgSubtle: string;
  /** Floating chrome over WebGL — STAYS DARK in both modes. */
  overlayBg: string;
  /** Foreground over `overlayBg` — STAYS LIGHT in both modes. */
  overlayText: string;
  /** Hairline border for overlay chrome — STAYS LIGHT in both modes. */
  overlayBorder: string;
  /** :focus-visible ring color, ~accent at 0.35 alpha. */
  focusRing: string;

  // Editor theme ──────────────────────────────────────────────
  monaco: MonacoTheme;
}

// ── Pastel palette (fade mode) ─────────────────────────────────────────────────

export interface PastelPalette {
  bgFrom: string;
  bgTo: string;
  cardBg: string;
  border: string;
}

export const PASTELS: PastelPalette[] = [
  { bgFrom: '#f4f3ee', bgTo: '#f4f3ee', cardBg: '#faf9f6', border: '#d0cdc4' },  // warm cream (home base)
  { bgFrom: '#fce4ec', bgTo: '#f3e5f5', cardBg: '#fef0f5', border: '#e8b4c8' },  // rose → lavender
  { bgFrom: '#e8eaf6', bgTo: '#e0f2f1', cardBg: '#f0f1fa', border: '#b0b8d6' },  // periwinkle → mint
  { bgFrom: '#fff8e1', bgTo: '#fff3e0', cardBg: '#fffbf0', border: '#e0d0a8' },  // buttercream → peach
  { bgFrom: '#e0f7fa', bgTo: '#e8f5e9', cardBg: '#f0fbfc', border: '#a8d8d0' },  // ice blue → sage
  { bgFrom: '#f3e5f5', bgTo: '#ede7f6', cardBg: '#f8f0fb', border: '#c8b0d8' },  // lilac → wisteria
  { bgFrom: '#fbe9e7', bgTo: '#fff8e1', cardBg: '#fef2f0', border: '#dcc0b0' },  // blush → cream
  { bgFrom: '#e8f5e9', bgTo: '#f1f8e9', cardBg: '#f2faf2', border: '#b8d8b0' },  // sage → chartreuse
  { bgFrom: '#e3f2fd', bgTo: '#e8eaf6', cardBg: '#f0f5fe', border: '#a8c0e0' },  // sky → steel
  { bgFrom: '#fce4ec', bgTo: '#fff8e1', cardBg: '#fef0f0', border: '#e0c0b0' },  // rose → butter
];

// ── Monaco token themes ────────────────────────────────────────────────────────

const MONACO_LIGHT: MonacoTheme = {
  background: '#faf9f6',
  foreground: '#1a1a1a',
  lineHighlight: '#f0efe8',
  lineNumber: '#cccccc',
  lineNumberActive: '#999999',
  selection: '#d4e8d0',
  cursor: '#1a3a2a',
  indentGuide: '#e8e8e0',
  tokens: {
    keyword: '#1a3a2a',
    keywordLet: '#6a4a8a',
    keywordGen: '#8b4513',
    keywordEvery: '#2b5a3a',
    keywordOperator: '#999999',
    variable: '#4a7a5a',
    variableDsp: '#8b0000',
    variableParam: '#8b0000',
    number: '#2b2b8a',
    numberRange: '#2b2b8a',
    function: '#6a4a8a',
    typeMove: '#2b5a8a',
    typeMode: '#2b5a8a',
    stringEasing: '#8a6a3a',
    stringPath: '#8a6a3a',
    stringColor: '#8b4513',
    comment: '#aaaaaa',
  },
};

const MONACO_DARK: MonacoTheme = {
  background: '#1a1918',
  foreground: '#e8e6e1',
  lineHighlight: '#222120',
  lineNumber: '#444342',
  lineNumberActive: '#888784',
  selection: '#2a4a3a',
  cursor: '#7fb89a',
  indentGuide: '#2a2926',
  tokens: {
    keyword: '#7fb89a',
    keywordLet: '#b8a0d8',
    keywordGen: '#d49b6a',
    keywordEvery: '#9bcfae',
    keywordOperator: '#777572',
    variable: '#a8c8b4',
    variableDsp: '#e09090',
    variableParam: '#e09090',
    number: '#9aa8e8',
    numberRange: '#9aa8e8',
    function: '#b8a0d8',
    typeMove: '#8ab4d8',
    typeMode: '#8ab4d8',
    stringEasing: '#d4b48a',
    stringPath: '#d4b48a',
    stringColor: '#d49b6a',
    comment: '#666563',
  },
};

// ── Theme presets ──────────────────────────────────────────────────────────────

export const LIGHT: Theme = {
  bg: '#f4f3ee',
  text: '#0a0a0a',
  textMuted: 'rgba(10,10,10,0.35)',
  border: '#d0cdc4',
  cardBg: '#faf9f6',
  cardBorder: '#d0cdc4',
  invertedBg: '#0a0a0a',
  invertedText: '#faf9f6',
  mode: 'light',

  accent: '#1a3a2a',
  accentText: '#faf9f6',
  accentBgSubtle: 'rgba(26,58,42,0.08)',
  danger: '#8b0000',
  warn: '#8b6914',
  cardBgSubtle: '#f0efe8',
  overlayBg: 'rgba(0,0,0,0.55)',
  overlayText: '#faf9f6',
  overlayBorder: 'rgba(255,255,255,0.12)',
  focusRing: 'rgba(26,58,42,0.35)',

  monaco: MONACO_LIGHT,
};

export const DARK: Theme = {
  bg: '#111110',
  text: '#e8e6e1',
  textMuted: 'rgba(232,230,225,0.35)',
  border: '#2a2926',
  cardBg: '#1a1918',
  cardBorder: '#2a2926',
  invertedBg: '#e8e6e1',
  invertedText: '#111110',
  mode: 'dark',

  accent: '#7fb89a',
  accentText: '#0a1a12',
  accentBgSubtle: 'rgba(127,184,154,0.10)',
  danger: '#e07070',
  warn: '#d4a850',
  cardBgSubtle: '#16151414',
  overlayBg: 'rgba(0,0,0,0.55)',
  overlayText: '#faf9f6',
  overlayBorder: 'rgba(255,255,255,0.12)',
  focusRing: 'rgba(127,184,154,0.45)',

  monaco: MONACO_DARK,
};

// ── Layout tokens ──────────────────────────────────────────────────────────────

/** Spacing scale — index = step. e.g. SPACE[3] = 12px. */
export const SPACE = [0, 4, 8, 12, 16, 24, 32, 48, 64] as const;

export const RADIUS = {
  sm: 6,
  md: 8,
  lg: 12,
  xl: 20,
  pill: 9999,
} as const;

export const SHADOW = {
  sm: '0 1px 2px rgba(20,15,10,0.04)',
  md: '0 2px 12px rgba(20,15,10,0.08)',
  lg: '0 8px 32px rgba(20,15,10,0.12)',
  xl: '0 16px 48px rgba(20,15,10,0.18)',
} as const;

export const SHADOW_DARK = {
  sm: '0 1px 2px rgba(0,0,0,0.35)',
  md: '0 2px 12px rgba(0,0,0,0.45)',
  lg: '0 8px 32px rgba(0,0,0,0.55)',
  xl: '0 16px 48px rgba(0,0,0,0.65)',
} as const;

export const FONT = {
  size: {
    xs: 11,
    sm: 12,
    body: 13,
    md: 14,
    lg: 16,
    xl: 20,
    hero: 28,
    display: 36,
  },
  weight: {
    regular: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
} as const;
