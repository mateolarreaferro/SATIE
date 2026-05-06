import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Editor, { type OnMount } from '@monaco-editor/react';
import type { Theme } from '../hooks/useDayNightCycle';
import { registerSatieLanguage } from './SatieEditor';

export interface ChatMessageData {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  script?: string;
  status: 'sending' | 'generating' | 'playing' | 'done' | 'error';
  error?: string;
  feedbackId?: string;
  rating?: number;
}

interface ChatMessageProps {
  message: ChatMessageData;
  theme: Theme;
  onSaveAsSketch?: (script: string, prompt: string) => void;
  savingSketch?: boolean;
  onRate?: (messageId: string, rating: 1 | -1) => void;
  onScriptEdit?: (messageId: string, newScript: string) => void;
}

const INLINE_LINE_HEIGHT = 19;
const INLINE_MIN_HEIGHT = 80;
const INLINE_MAX_HEIGHT = 200;
const INLINE_PADDING = 12;

/** Shared Monaco options for both inline and expanded editors */
const EDITOR_OPTIONS = {
  fontFamily: "'SF Mono', 'Fira Code', 'Consolas', monospace",
  minimap: { enabled: false },
  wordWrap: 'on' as const,
  scrollBeyondLastLine: false,
  tabSize: 2,
  renderWhitespace: 'none' as const,
  bracketPairColorization: { enabled: false },
  overviewRulerBorder: false,
  overviewRulerLanes: 0,
  hideCursorInOverviewRuler: true,
  renderLineHighlight: 'line' as const,
  lineDecorationsWidth: 4,
  lineNumbersMinChars: 3,
  glyphMargin: false,
  folding: false,
  quickSuggestions: { other: true, comments: false, strings: false },
  suggestOnTriggerCharacters: true,
};

function EditableScript({ script, messageId, theme, onScriptEdit }: {
  script: string;
  messageId: string;
  theme: Theme;
  onScriptEdit?: (messageId: string, newScript: string) => void;
}) {
  const [editedScript, setEditedScript] = useState(script);
  const [dirty, setDirty] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const handleRunRef = useRef<() => void>(() => {});
  const expandedRef = useRef(false);
  expandedRef.current = expanded;

  const inlineHeight = Math.min(
    Math.max(script.split('\n').length * INLINE_LINE_HEIGHT + INLINE_PADDING, INLINE_MIN_HEIGHT),
    INLINE_MAX_HEIGHT,
  );

  // Sync if parent script changes (e.g. new generation)
  useEffect(() => {
    setEditedScript(script);
    setDirty(false);
  }, [script]);

  const handleChange = (value: string | undefined) => {
    const v = value ?? '';
    setEditedScript(v);
    setDirty(v !== script);
  };

  const handleRun = useCallback(() => {
    if (onScriptEdit) {
      onScriptEdit(messageId, editedScript);
      setDirty(false);
    }
  }, [onScriptEdit, messageId, editedScript]);
  handleRunRef.current = handleRun;

  // Determine dark vs light based on theme bg luminance
  const isDark = (() => {
    const bg = theme.bg;
    // Parse hex color
    const match = bg.match(/#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
    if (!match) return false;
    const r = parseInt(match[1], 16) / 255;
    const g = parseInt(match[2], 16) / 255;
    const b = parseInt(match[3], 16) / 255;
    return (0.299 * r + 0.587 * g + 0.114 * b) < 0.5;
  })();

  const monacoTheme = isDark ? 'satie-dark' : 'satie-light';

  const handleMount: OnMount = useCallback((editor, monaco) => {
    registerSatieLanguage(monaco);
    // Set correct theme for current mode
    monaco.editor.setTheme(monacoTheme);

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      handleRunRef.current();
    });

    // Escape to close the expanded editor
    editor.addCommand(monaco.KeyCode.Escape, () => {
      if (expandedRef.current) setExpanded(false);
    });

    // Focus the editor after mount
    setTimeout(() => editor.focus(), 80);
  }, [monacoTheme]);

  // Modal card colors from theme tokens — no more ad-hoc isDark ternaries.
  const cardBg = theme.cardBg;
  const cardText = theme.text;
  const cardBorder = theme.cardBorder;
  const accentBg = theme.accent;

  return (
    <>
      {/* Inline preview — click to expand */}
      <div
        onClick={() => setExpanded(true)}
        style={{
          marginTop: 4,
          cursor: 'pointer',
          position: 'relative',
        }}
      >
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          fontSize: '13px',
          opacity: 0.5,
          fontFamily: "'SF Mono', 'Fira Code', monospace",
          userSelect: 'none',
          marginBottom: 4,
        }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={theme.text} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="16 18 22 12 16 6" />
            <polyline points="8 6 2 12 8 18" />
          </svg>
          script
          {dirty && <span style={{ fontSize: '11px', opacity: 0.7 }}>(edited)</span>}
          {/* Expand icon */}
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={theme.text} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 'auto', opacity: 0.4 }}>
            <polyline points="15 3 21 3 21 9" />
            <polyline points="9 21 3 21 3 15" />
            <line x1="21" y1="3" x2="14" y2="10" />
            <line x1="3" y1="21" x2="10" y2="14" />
          </svg>
        </div>

        {/* Read-only inline preview */}
        <pre style={{
          fontFamily: "'SF Mono', 'Fira Code', monospace",
          fontSize: '12px',
          lineHeight: 1.5,
          padding: '8px 12px',
          background: `${theme.bg}80`,
          borderRadius: 8,
          overflow: 'hidden',
          maxHeight: inlineHeight,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          margin: 0,
          position: 'relative',
        }}>
          {editedScript}
          {/* Fade-out at bottom if content overflows */}
          <div style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: 32,
            background: `linear-gradient(transparent, ${theme.cardBg})`,
            pointerEvents: 'none',
          }} />
        </pre>
      </div>

      {/* Expanded modal overlay */}
      {expanded && createPortal(
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            background: isDark ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.45)',
            animation: 'chatEditorFadeIn 0.2s ease-out',
          }}
          onKeyDown={(e) => {
            // Stop ALL key events inside the overlay from reaching fly controls
            e.stopPropagation();
          }}
          onClick={(e) => {
            // Close when clicking the backdrop (not the card)
            if (e.target === e.currentTarget) setExpanded(false);
          }}
        >
          <style>{`
            @keyframes chatEditorFadeIn {
              from { opacity: 0; }
              to { opacity: 1; }
            }
            @keyframes chatEditorSlideUp {
              from { opacity: 0; transform: translateY(20px) scale(0.97); }
              to { opacity: 1; transform: translateY(0) scale(1); }
            }
          `}</style>

          <div style={{
            width: 'min(720px, 90vw)',
            maxHeight: '80vh',
            display: 'flex',
            flexDirection: 'column',
            borderRadius: 16,
            overflow: 'hidden',
            background: cardBg,
            boxShadow: '0 24px 80px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.06)',
            animation: 'chatEditorSlideUp 0.25s ease-out',
          }}>
            {/* Header bar */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              padding: '10px 16px',
              borderBottom: `1px solid ${cardBorder}`,
              gap: 8,
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={cardText} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
                <polyline points="16 18 22 12 16 6" />
                <polyline points="8 6 2 12 8 18" />
              </svg>
              <span style={{
                fontSize: '14px',
                fontFamily: "'SF Mono', 'Fira Code', monospace",
                fontWeight: 500,
                color: cardText,
                flex: 1,
              }}>
                edit script
              </span>

              {/* Run button */}
              {dirty && (
                <button
                  onClick={handleRun}
                  style={{
                    padding: '5px 14px',
                    fontSize: '13px',
                    fontFamily: "'Inter', system-ui, sans-serif",
                    background: accentBg,
                    color: '#fff',
                    border: 'none',
                    borderRadius: 6,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    fontWeight: 500,
                  }}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="#fff" stroke="none">
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                  run
                </button>
              )}

              {/* Keyboard shortcut hint */}
              <span style={{
                fontSize: '11px',
                fontFamily: "'SF Mono', monospace",
                opacity: 0.3,
                color: cardText,
              }}>
                {dirty ? '\u2318\u23CE run' : 'esc close'}
              </span>

              {/* Close button */}
              <button
                onClick={() => setExpanded(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 4,
                  opacity: 0.4,
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={cardText} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Monaco editor — full size */}
            <div style={{ flex: 1, minHeight: 0 }}>
              <Editor
                height="min(60vh, 600px)"
                language="satie"
                theme={monacoTheme}
                value={editedScript}
                onChange={handleChange}
                onMount={handleMount}
                options={{
                  ...EDITOR_OPTIONS,
                  fontSize: 14,
                  lineNumbers: 'on',
                  padding: { top: 12, bottom: 12 },
                  scrollbar: { vertical: 'auto', horizontal: 'hidden', verticalScrollbarSize: 8 },
                }}
              />
            </div>

            {/* Footer */}
            <div style={{
              padding: '8px 16px',
              borderTop: `1px solid ${cardBorder}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '12px',
              fontFamily: "'Inter', system-ui, sans-serif",
              color: cardText,
              opacity: 0.4,
            }}>
              <span>{editedScript.split('\n').length} lines</span>
              <span>{dirty ? 'unsaved changes' : 'up to date'}</span>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

export function ChatMessage({ message, theme, onSaveAsSketch, savingSketch, onRate, onScriptEdit }: ChatMessageProps) {
  if (message.role === 'user') {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'flex-end',
        marginBottom: 12,
      }}>
        <div style={{
          maxWidth: '80%',
          padding: '10px 16px',
          borderRadius: 16,
          background: theme.invertedBg,
          color: theme.invertedText,
          fontSize: '15px',
          fontFamily: "'Inter', system-ui, sans-serif",
          lineHeight: 1.5,
          opacity: 0.9,
        }}>
          {message.content}
        </div>
      </div>
    );
  }

  // Assistant message
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'flex-start',
      marginBottom: 12,
    }}>
      <div style={{
        maxWidth: '85%',
        padding: '10px 16px',
        borderRadius: 16,
        background: `${theme.cardBg}cc`,
        backdropFilter: 'blur(8px)',
        border: `1px solid ${theme.border}`,
        fontSize: '15px',
        fontFamily: "'Inter', system-ui, sans-serif",
        lineHeight: 1.5,
        color: theme.text,
      }}>
        {/* Generating — animated waveform dots */}
        {message.status === 'generating' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: 0.6 }}>
            <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
              {[0, 1, 2, 3, 4].map(i => (
                <div key={i} style={{
                  width: 3,
                  height: 12,
                  borderRadius: 1.5,
                  background: theme.text,
                  opacity: 0.5,
                  animation: `waveBar 1.2s ease-in-out ${i * 0.1}s infinite`,
                }} />
              ))}
            </div>
            <span style={{ fontSize: '14px' }}>generating soundscape...</span>
            <style>{`@keyframes waveBar { 0%, 100% { transform: scaleY(0.4); opacity: 0.3; } 50% { transform: scaleY(1); opacity: 0.8; } }`}</style>
          </div>
        )}

        {/* Error */}
        {message.status === 'error' && (
          <div style={{ color: theme.danger, display: 'flex', alignItems: 'center', gap: 6 }}>
            {/* Alert circle icon */}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8b0000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            {message.error || 'Something went wrong'}
          </div>
        )}

        {/* Playing / Done */}
        {(message.status === 'playing' || message.status === 'done') && (
          <>
            <div style={{ marginBottom: message.script ? 8 : 0, display: 'flex', alignItems: 'center', gap: 6 }}>
              {message.status === 'playing' ? (
                <>
                  {/* Volume/speaker icon */}
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={theme.text} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                    <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
                  </svg>
                  playing
                </>
              ) : (
                <>
                  {/* Check circle icon */}
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={theme.text} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                    <polyline points="22 4 12 14.01 9 11.01" />
                  </svg>
                  soundscape ready
                </>
              )}
            </div>

            {/* Collapsible editable script */}
            {message.script && (
              <EditableScript
                script={message.script}
                messageId={message.id}
                theme={theme}
                onScriptEdit={onScriptEdit}
              />
            )}

            {/* Actions row: save + feedback */}
            {message.script && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                {onSaveAsSketch && (
                  <button
                    onClick={() => onSaveAsSketch(message.script!, message.content)}
                    disabled={savingSketch}
                    style={{
                      padding: '4px 12px',
                      fontSize: '13px',
                      fontFamily: "'Inter', system-ui, sans-serif",
                      background: 'none',
                      border: `1px solid ${theme.border}`,
                      borderRadius: 6,
                      cursor: savingSketch ? 'wait' : 'pointer',
                      color: theme.text,
                      opacity: savingSketch ? 0.4 : 0.6,
                      transition: 'opacity 0.15s',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 5,
                    }}
                    onMouseEnter={(e) => { if (!savingSketch) e.currentTarget.style.opacity = '1'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.opacity = savingSketch ? '0.4' : '0.6'; }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={theme.text} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                    </svg>
                    {savingSketch ? 'saving…' : 'save as sketch'}
                  </button>
                )}

                {/* RLHF: Thumbs up / down */}
                {message.feedbackId && onRate && (
                  <div style={{ display: 'flex', gap: 2 }}>
                    <button
                      onClick={() => onRate(message.id, 1)}
                      title="Good generation"
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        padding: '2px 4px',
                        opacity: message.rating === 1 ? 1 : 0.25,
                        transition: 'opacity 0.15s',
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill={message.rating === 1 ? theme.text : 'none'} stroke={theme.text} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/>
                        <path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/>
                      </svg>
                    </button>
                    <button
                      onClick={() => onRate(message.id, -1)}
                      title="Bad generation"
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        padding: '2px 4px',
                        opacity: message.rating === -1 ? 1 : 0.25,
                        transition: 'opacity 0.15s',
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill={message.rating === -1 ? theme.danger : 'none'} stroke={theme.danger} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10z"/>
                        <path d="M17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/>
                      </svg>
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
