import type { Theme } from '../hooks/useDayNightCycle';

export interface ChatMessageData {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  script?: string;
  status: 'sending' | 'generating' | 'playing' | 'done' | 'error';
  error?: string;
}

interface ChatMessageProps {
  message: ChatMessageData;
  theme: Theme;
  onSaveAsSketch?: (script: string, prompt: string) => void;
}

export function ChatMessage({ message, theme, onSaveAsSketch }: ChatMessageProps) {
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
          <div style={{ color: '#8b0000', display: 'flex', alignItems: 'center', gap: 6 }}>
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

            {/* Collapsible script */}
            {message.script && (
              <details style={{ marginTop: 4 }}>
                <summary style={{
                  cursor: 'pointer',
                  fontSize: '13px',
                  opacity: 0.5,
                  fontFamily: "'SF Mono', 'Fira Code', monospace",
                  userSelect: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                }}>
                  {/* Code icon */}
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={theme.text} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="16 18 22 12 16 6" />
                    <polyline points="8 6 2 12 8 18" />
                  </svg>
                  script
                </summary>
                <pre style={{
                  fontFamily: "'SF Mono', 'Fira Code', monospace",
                  fontSize: '12px',
                  lineHeight: 1.5,
                  padding: '8px 12px',
                  marginTop: 6,
                  background: `${theme.bg}80`,
                  borderRadius: 8,
                  overflow: 'auto',
                  maxHeight: 200,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}>
                  {message.script}
                </pre>
              </details>
            )}

            {/* Save as sketch button */}
            {message.script && onSaveAsSketch && (
              <button
                onClick={() => onSaveAsSketch(message.script!, message.content)}
                style={{
                  marginTop: 8,
                  padding: '4px 12px',
                  fontSize: '13px',
                  fontFamily: "'Inter', system-ui, sans-serif",
                  background: 'none',
                  border: `1px solid ${theme.border}`,
                  borderRadius: 6,
                  cursor: 'pointer',
                  color: theme.text,
                  opacity: 0.6,
                  transition: 'opacity 0.15s',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
                onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.6'; }}
              >
                {/* Save/bookmark icon */}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={theme.text} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                </svg>
                save as sketch
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
