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
        {/* Status indicators */}
        {message.status === 'generating' && (
          <div style={{ opacity: 0.5 }}>
            <span style={{ animation: 'pulse 1.5s ease-in-out infinite' }}>generating soundscape...</span>
            <style>{`@keyframes pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 0.8; } }`}</style>
          </div>
        )}

        {message.status === 'error' && (
          <div style={{ color: '#8b0000' }}>
            {message.error || 'Something went wrong'}
          </div>
        )}

        {(message.status === 'playing' || message.status === 'done') && (
          <>
            <div style={{ marginBottom: message.script ? 8 : 0 }}>
              {message.status === 'playing' ? 'playing' : 'soundscape ready'}
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
                }}>
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
                }}
                onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
                onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.6'; }}
              >
                save as sketch
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
