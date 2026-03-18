import { useState, memo } from 'react';

interface Section {
  title: string;
  id: string;
  content: string;
}

const SECTIONS: Section[] = [
  {
    title: 'Quick Start',
    id: 'quickstart',
    content: `# Quick Start

**Play a looping sound:**
\`\`\`
loop rain.wav
\`\`\`

**Play a one-shot sound every 2–4 seconds:**
\`\`\`
oneshot snap.wav every 2to4
\`\`\`

**Add properties (indented below the statement):**
\`\`\`
loop rain.wav
  volume 0.6
  move walk -5 -5 5 5
  reverb 0.4 0.7 0.5
\`\`\`

**Multiple copies:**
\`\`\`
5 * loop birds.wav every 3to8
  volume 0.2to0.5
  move fly -10 0 -10 10 5 10
\`\`\`

**Press Cmd+Enter (Ctrl+Enter) to run your script.**`,
  },
  {
    title: 'Statements',
    id: 'statements',
    content: `# Statements

Every sound starts with a statement line:

\`\`\`
[count *] loop|oneshot clip [every N|NtoN]
\`\`\`

| Part | Description |
|------|-------------|
| \`count *\` | Spawn multiple copies (e.g. \`5 *\`) |
| \`loop\` | Play audio in a continuous loop |
| \`oneshot\` | Play audio once (or retrigger with \`every\`) |
| \`clip\` | Audio filename (e.g. \`rain.wav\`) |
| \`every N\` | Retrigger interval in seconds |

**AI-generated audio:**
\`\`\`
loop gen "gentle rain on leaves"
oneshot gen "thunder crack" every 10to20
\`\`\``,
  },
  {
    title: 'Properties',
    id: 'properties',
    content: `# Properties

Properties are indented below their statement:

| Property | Values | Description |
|----------|--------|-------------|
| \`volume\` | 0–1 or range | Amplitude |
| \`pitch\` | number or range | Playback rate (1 = normal) |
| \`start\` | seconds | When to begin playing |
| \`end\` | seconds | When to stop playing |
| \`duration\` | seconds | How long to play |
| \`fade_in\` | seconds | Fade-in time |
| \`fade_out\` | seconds | Fade-out time |
| \`color\` | #hex / name / r g b | Visual color |
| \`alpha\` | 0–1 | Visual opacity |
| \`visual\` | sphere/cube/trail/none | 3D visual type |
| \`background\` | #hex / name / 0-255 | Viewport background color |

**Flags** (no value needed):
\`overlap\`, \`persistent\`, \`mute\`, \`solo\`, \`randomstart\`, \`loopable\``,
  },
  {
    title: 'Ranges',
    id: 'ranges',
    content: `# Ranges

Use \`minTomax\` for random values sampled per voice:

\`\`\`
volume 0.3to0.8
pitch 0.8to1.2
start 0to5
every 2to6
\`\`\`

Each copy gets its own random value within the range.`,
  },
  {
    title: 'Interpolation',
    id: 'interpolation',
    content: `# Interpolation

Animate any numeric property over time:

**goto** — one-way transition:
\`\`\`
volume goto(0 1 3)        # 0 → 1 over 3 seconds
volume goto(0 1 3 inquad) # with easing
\`\`\`

**gobetween** — ping-pong oscillation:
\`\`\`
volume gobetween(0.2 0.8 2)       # oscillate forever
volume gobetween(0.2 0.8 2 3)     # 3 cycles
volume gobetween(0.2 0.8 2 outsine) # with easing
\`\`\`

**interpolate** — same as goto (alias):
\`\`\`
pitch interpolate(0.5 2 10 incubic)
\`\`\`

**Easing curves:**
\`linear\`, \`insine\`, \`outsine\`, \`inoutsine\`,
\`inquad\`, \`outquad\`, \`inoutquad\`,
\`incubic\`, \`outcubic\`, \`inoutcubic\`,
\`inexpo\`, \`outexpo\`, \`inoutexpo\``,
  },
  {
    title: 'Movement',
    id: 'movement',
    content: `# Spatial Movement

Position voices in 3D space:

**walk** — ground plane (Y=0):
\`\`\`
move walk -5 -5 5 5          # x1 z1 x2 z2
\`\`\`

**fly** — full 3D volume:
\`\`\`
move fly -5 0 -5 5 5 5       # x1 y1 z1 x2 y2 z2
\`\`\`

**fixed** — stationary position:
\`\`\`
move fixed 3 1 -2             # x y z
\`\`\`

**Trajectories** — predefined curves:
\`\`\`
move spiral -5 0 -5 5 5 5
move orbit -3 0 -3 3 3 3
move lorenz -5 0 -5 5 5 5
\`\`\`

**Speed & noise:**
\`\`\`
speed 0.5
noise 0.3
\`\`\``,
  },
  {
    title: 'DSP Effects',
    id: 'effects',
    content: `# DSP Effects

All effects support static values, ranges, and interpolation.

**Reverb:**
\`\`\`
reverb wet size damping
reverb 0.4 0.7 0.5
\`\`\`

**Delay:**
\`\`\`
delay wet time feedback [pingpong]
delay 0.3 0.25 0.5 pingpong
\`\`\`

**Filter:**
\`\`\`
filter mode cutoff resonance [wet]
filter lowpass 800 2 0.8
\`\`\`
Modes: \`lowpass\`, \`highpass\`, \`bandpass\`, \`notch\`, \`peak\`

**Distortion:**
\`\`\`
distortion mode drive [wet]
distortion softclip 4 0.6
\`\`\`
Modes: \`softclip\`, \`hardclip\`, \`tanh\`, \`cubic\`, \`asymmetric\`

**EQ (3-band):**
\`\`\`
eq low mid high
eq 3 -2 1
\`\`\`
Low: 320 Hz shelf · Mid: 1 kHz peak · High: 3.2 kHz shelf`,
  },
  {
    title: 'Groups',
    id: 'groups',
    content: `# Groups

Share properties across multiple voices:

\`\`\`
group
  volume 0.4
  move fly -5 0 -5 5 5 5
  reverb 0.3 0.5 0.4

  loop rain.wav
  loop wind.wav
  3 * oneshot birds.wav every 4to10
endgroup
\`\`\`

Children inherit group properties. Child-level properties override the group.`,
  },
  {
    title: 'Variables',
    id: 'variables',
    content: `# Variables

Define reusable values:

\`\`\`
let $area = -5 0 -5 5 5 5
let $vol = 0.3to0.6

loop rain.wav
  volume $vol
  move fly $area
\`\`\`

Variables are expanded textually before parsing.`,
  },
  {
    title: 'Comments',
    id: 'comments',
    content: `# Comments

**Inline comment:**
\`\`\`
loop rain.wav  # this is a comment
\`\`\`

**Block comment:**
\`\`\`
comment
  This entire block is ignored.
  Useful for disabling sections.
endcomment
\`\`\``,
  },
];

const navStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '4px',
  padding: '0 12px 8px',
  borderBottom: '1px solid #e8e0d8',
};

const navBtnStyle = (active: boolean): React.CSSProperties => ({
  padding: '3px 8px',
  fontSize: '10px',
  fontFamily: "'Inter', system-ui, sans-serif",
  background: active ? '#1a3a2a' : 'transparent',
  color: active ? '#faf9f6' : '#1a3a2a',
  border: active ? 'none' : '1px solid #d0cdc4',
  borderRadius: 10,
  cursor: 'pointer',
  fontWeight: active ? 600 : 400,
});

const contentStyle: React.CSSProperties = {
  flex: 1,
  overflow: 'auto',
  padding: '12px 16px',
  fontSize: '12px',
  fontFamily: "'Inter', system-ui, sans-serif",
  color: '#1a1a1a',
  lineHeight: 1.6,
};

export const DocsPanel = memo(function DocsPanel() {
  const [activeSection, setActiveSection] = useState('quickstart');

  const section = SECTIONS.find(s => s.id === activeSection) ?? SECTIONS[0];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Navigation */}
      <div style={navStyle}>
        {SECTIONS.map(s => (
          <button
            key={s.id}
            onClick={() => setActiveSection(s.id)}
            style={navBtnStyle(s.id === activeSection)}
          >
            {s.title}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={contentStyle}>
        <MarkdownRenderer content={section.content} />
      </div>
    </div>
  );
});

// ── Minimal markdown renderer ────────────────────────────────

function MarkdownRenderer({ content }: { content: string }) {
  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Heading
    if (line.startsWith('# ')) {
      elements.push(
        <h2 key={i} style={{ fontSize: '16px', fontWeight: 600, color: '#1a3a2a', margin: '0 0 12px', letterSpacing: '-0.01em' }}>
          {line.slice(2)}
        </h2>
      );
      i++;
      continue;
    }

    // Code block
    if (line.startsWith('```')) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      elements.push(
        <pre key={`code-${i}`} style={{
          background: '#f0efe8',
          borderRadius: 8,
          padding: '10px 12px',
          margin: '8px 0',
          fontSize: '11px',
          fontFamily: "'SF Mono', 'Fira Code', monospace",
          lineHeight: 1.5,
          overflow: 'auto',
          border: '1px solid #e0ddd4',
        }}>
          {codeLines.join('\n')}
        </pre>
      );
      continue;
    }

    // Table
    if (line.includes('|') && line.trim().startsWith('|')) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i]);
        i++;
      }
      elements.push(<SimpleTable key={`table-${i}`} lines={tableLines} />);
      continue;
    }

    // Bold text: **text**
    if (line.startsWith('**') && line.endsWith('**')) {
      elements.push(
        <p key={i} style={{ fontWeight: 600, margin: '10px 0 4px', fontSize: '12px' }}>
          {line.slice(2, -2)}
        </p>
      );
      i++;
      continue;
    }

    // Regular paragraph
    if (line.trim()) {
      elements.push(
        <p key={i} style={{ margin: '4px 0', fontSize: '12px' }}>
          <InlineMarkdown text={line} />
        </p>
      );
    } else {
      elements.push(<div key={i} style={{ height: 6 }} />);
    }
    i++;
  }

  return <>{elements}</>;
}

function InlineMarkdown({ text }: { text: string }) {
  // Handle inline code `code` and bold **text**
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('`') && part.endsWith('`')) {
          return (
            <code key={i} style={{
              background: '#f0efe8',
              padding: '1px 5px',
              borderRadius: 3,
              fontSize: '11px',
              fontFamily: "'SF Mono', monospace",
            }}>
              {part.slice(1, -1)}
            </code>
          );
        }
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={i}>{part.slice(2, -2)}</strong>;
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

function SimpleTable({ lines }: { lines: string[] }) {
  // Parse markdown table: | h1 | h2 | ... then |---| then rows
  const parseRow = (line: string) =>
    line.split('|').slice(1, -1).map(c => c.trim());

  if (lines.length < 2) return null;
  const headers = parseRow(lines[0]);
  const isSeparator = (l: string) => /^\|[\s-:|]+\|$/.test(l.trim());
  const dataStart = isSeparator(lines[1]) ? 2 : 1;
  const rows = lines.slice(dataStart).map(parseRow);

  return (
    <table style={{
      borderCollapse: 'collapse',
      width: '100%',
      margin: '8px 0',
      fontSize: '11px',
    }}>
      <thead>
        <tr>
          {headers.map((h, i) => (
            <th key={i} style={{
              textAlign: 'left',
              padding: '4px 8px',
              borderBottom: '1.5px solid #d0cdc4',
              fontWeight: 600,
              color: '#1a3a2a',
              fontSize: '10px',
            }}>
              <InlineMarkdown text={h} />
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, ri) => (
          <tr key={ri}>
            {row.map((cell, ci) => (
              <td key={ci} style={{
                padding: '3px 8px',
                borderBottom: '1px solid #e8e0d8',
                fontSize: '11px',
              }}>
                <InlineMarkdown text={cell} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
