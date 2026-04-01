import { useState, useCallback, useRef, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../lib/AuthContext';
import { createSketch } from '../../lib/sketches';
import { generateCode } from '../../lib/aiGenerate';
import { createProvider } from '../../lib/aiProvider';
import { useDayNightCycle, type ThemeMode } from '../hooks/useDayNightCycle';
import { useSatieEngine } from '../hooks/useSatieEngine';
import { RiverCanvas } from '../components/RiverCanvas';
import { SpatialViewport } from '../components/SpatialViewport';
import { ChatMessage, type ChatMessageData } from '../components/ChatMessage';
import { ChatInput } from '../components/ChatInput';

const SUGGESTIONS = [
  'a forest at dawn with birds and wind',
  'underwater cathedral with whale songs',
  'rain on a tin roof at night',
  'celestial choir orbiting in space',
];

export function Chat() {
  const navigate = useNavigate();
  const { user, signInWithGitHub, signInWithGoogle } = useAuth();
  const { mode, theme, setMode } = useDayNightCycle();
  const { uiState, tracksRef, loadScript, play, stop } = useSatieEngine();

  const [messages, setMessages] = useState<ChatMessageData[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentScript, setCurrentScript] = useState<string | null>(null);
  const [hasActiveTracks, setHasActiveTracks] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const messageIdCounter = useRef(0);

  // Track whether there are active tracks for conditional viewport mount
  useEffect(() => {
    const interval = setInterval(() => {
      const count = tracksRef.current?.length ?? 0;
      setHasActiveTracks(count > 0);
    }, 500);
    return () => clearInterval(interval);
  }, [tracksRef]);

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [messages]);

  const nextId = useCallback(() => {
    messageIdCounter.current += 1;
    return `msg-${messageIdCounter.current}`;
  }, []);

  const sendMessage = useCallback(async (prompt: string) => {
    if (isGenerating) return;

    // Validate that a provider is available
    try {
      createProvider();
    } catch {
      const errId = nextId();
      setMessages(prev => [
        ...prev,
        { id: nextId(), role: 'user', content: prompt, status: 'done' },
        { id: errId, role: 'assistant', content: '', status: 'error', error: 'No AI provider configured. Add an API key in settings.' },
      ]);
      return;
    }

    const userId = nextId();
    const assistantId = nextId();

    setMessages(prev => [
      ...prev,
      { id: userId, role: 'user', content: prompt, status: 'done' },
      { id: assistantId, role: 'assistant', content: prompt, status: 'generating' },
    ]);
    setIsGenerating(true);

    try {
      // Build conversation history from recent messages (last 6 pairs)
      const history = messages
        .filter(m => m.status !== 'error' && m.status !== 'generating')
        .slice(-12)
        .map(m => ({
          role: m.role,
          content: m.role === 'assistant' ? (m.script ?? m.content) : m.content,
        }));

      const result = await generateCode(
        prompt,
        currentScript ?? undefined,
        [], // no loaded samples in chat mode — AI uses gen blocks
        history,
      );

      if (/\b(loop|oneshot)\b/.test(result.code)) {
        setCurrentScript(result.code);
        loadScript(result.code);
        if (!uiState.isPlaying) play();
      }

      setMessages(prev => prev.map(m =>
        m.id === assistantId
          ? { ...m, script: result.code, status: 'playing' as const, error: result.error ?? undefined }
          : m
      ));
    } catch (e: any) {
      setMessages(prev => prev.map(m =>
        m.id === assistantId
          ? { ...m, status: 'error' as const, error: e.message }
          : m
      ));
    } finally {
      setIsGenerating(false);
    }
  }, [isGenerating, messages, currentScript, loadScript, play, uiState.isPlaying, nextId]);

  const handleSaveAsSketch = useCallback(async (script: string, prompt: string) => {
    if (!user) return;
    try {
      const title = prompt.slice(0, 50) || 'untitled';
      const sketch = await createSketch(user.id, title, script);
      navigate(`/editor/${sketch.id}`);
    } catch (e: any) {
      console.error('Failed to save sketch:', e);
    }
  }, [user, navigate]);

  const handleStop = useCallback(() => {
    stop();
    setHasActiveTracks(false);
  }, [stop]);

  const isEmpty = messages.length === 0;

  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      background: theme.bg,
      color: theme.text,
      fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      position: 'relative',
      transition: 'background 1.5s ease, color 1.5s ease',
    }}>
      {/* Layer 1: Background animation */}
      <RiverCanvas mode={mode} />

      {/* Layer 2: 3D viewport overlay — always mounted so camera controls are available */}
      {hasActiveTracks && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 1 }}>
          <SpatialViewport tracksRef={tracksRef} overlayMode />
        </div>
      )}

      {/* Layer 3: Chat UI — pointerEvents:none on wrapper, auto on interactive children */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 2, display: 'flex', flexDirection: 'column', pointerEvents: 'none' }}>
        {/* Header — pointer events re-enabled */}
        <header style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 32px',
          borderBottom: `1px solid ${theme.border}`,
          flexShrink: 0,
          pointerEvents: 'auto',
        }}>
          {/* Left — theme toggle */}
          <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: 2 }}>
              {(['light', 'fade', 'dark'] as ThemeMode[]).map(m => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  style={{
                    padding: '2px 7px',
                    fontSize: '16px',
                    fontFamily: "'Inter', system-ui, sans-serif",
                    fontWeight: mode === m ? 600 : 400,
                    background: mode === m ? theme.invertedBg : 'transparent',
                    color: mode === m ? theme.invertedText : theme.text,
                    border: 'none',
                    borderRadius: 4,
                    cursor: 'pointer',
                    opacity: mode === m ? 1 : 0.25,
                    transition: 'all 0.2s',
                    letterSpacing: '0.02em',
                  }}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          {/* Center — nav links */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '14px' }}>
            <span style={{
              fontSize: '24px',
              fontWeight: 700,
              letterSpacing: '0.06em',
              color: theme.text,
              cursor: 'default',
            }}>
              satie
            </span>
            <Link to="/sketches" style={{
              fontSize: '16px',
              color: theme.text,
              opacity: 0.25,
              textDecoration: 'none',
              fontWeight: 400,
            }}>
              sketches
            </Link>
            <Link to="/explore" style={{
              fontSize: '16px',
              color: theme.text,
              opacity: 0.25,
              textDecoration: 'none',
              fontWeight: 400,
            }}>
              explore
            </Link>
          </div>

          {/* Right — user controls */}
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '14px' }}>
            {/* Stop button — only when playing */}
            {uiState.isPlaying && (
              <button
                onClick={handleStop}
                style={{
                  padding: '4px 12px',
                  fontSize: '14px',
                  fontFamily: "'Inter', system-ui, sans-serif",
                  background: 'none',
                  border: `1px solid ${theme.text}40`,
                  borderRadius: 6,
                  cursor: 'pointer',
                  color: theme.text,
                  opacity: 0.6,
                }}
              >
                stop
              </button>
            )}
            {user ? (
              <div style={{
                width: 34,
                height: 34,
                background: theme.text,
                borderRadius: 17,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '16px',
                color: theme.invertedText,
                fontWeight: 600,
              }} title={user.email ?? ''}>
                {(user.email?.[0] ?? '?').toUpperCase()}
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={signInWithGitHub} style={{
                  padding: '4px 12px',
                  fontSize: '14px',
                  fontFamily: "'Inter', system-ui, sans-serif",
                  background: 'none',
                  border: `1px solid ${theme.text}40`,
                  borderRadius: 6,
                  cursor: 'pointer',
                  color: theme.text,
                }}>
                  GitHub
                </button>
                <button onClick={signInWithGoogle} style={{
                  padding: '4px 12px',
                  fontSize: '14px',
                  fontFamily: "'Inter', system-ui, sans-serif",
                  background: 'none',
                  border: `1px solid ${theme.text}40`,
                  borderRadius: 6,
                  cursor: 'pointer',
                  color: theme.text,
                }}>
                  Google
                </button>
              </div>
            )}
          </div>
        </header>

        {/* Content area */}
        {!user ? (
          /* Auth gate */
          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 24,
            pointerEvents: 'auto',
          }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{
                fontSize: '48px',
                fontWeight: 700,
                letterSpacing: '0.06em',
                marginBottom: 8,
              }}>
                satie
              </div>
              <div style={{
                fontSize: '16px',
                opacity: 0.4,
              }}>
                sign in to create soundscapes
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={signInWithGitHub} style={{
                padding: '8px 20px',
                fontSize: '15px',
                fontFamily: "'Inter', system-ui, sans-serif",
                background: theme.invertedBg,
                color: theme.invertedText,
                border: 'none',
                borderRadius: 8,
                cursor: 'pointer',
                fontWeight: 500,
              }}>
                Sign in with GitHub
              </button>
              <button onClick={signInWithGoogle} style={{
                padding: '8px 20px',
                fontSize: '15px',
                fontFamily: "'Inter', system-ui, sans-serif",
                background: 'none',
                border: `1px solid ${theme.text}`,
                color: theme.text,
                borderRadius: 8,
                cursor: 'pointer',
                fontWeight: 500,
              }}>
                Sign in with Google
              </button>
            </div>
          </div>
        ) : (
          /* Chat area */
          <>
            <div
              ref={scrollRef}
              style={{
                flex: 1,
                overflow: 'auto',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: isEmpty ? 'center' : 'flex-start',
                padding: '24px 24px 0',
                pointerEvents: 'auto',
              }}
            >
              <div style={{
                width: '100%',
                maxWidth: 680,
                margin: '0 auto',
              }}>
                {isEmpty ? (
                  /* Empty state */
                  <div style={{ textAlign: 'center', paddingBottom: 40 }}>
                    <div style={{
                      fontSize: '48px',
                      fontWeight: 700,
                      letterSpacing: '0.06em',
                      marginBottom: 8,
                    }}>
                      satie
                    </div>
                    <div style={{
                      fontSize: '16px',
                      opacity: 0.4,
                      marginBottom: 32,
                    }}>
                      describe a soundscape
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
                      {SUGGESTIONS.map(s => (
                        <button
                          key={s}
                          onClick={() => sendMessage(s)}
                          disabled={isGenerating}
                          style={{
                            padding: '8px 16px',
                            fontSize: '14px',
                            fontFamily: "'Inter', system-ui, sans-serif",
                            background: `${theme.cardBg}aa`,
                            backdropFilter: 'blur(8px)',
                            border: `1px solid ${theme.border}`,
                            borderRadius: 20,
                            cursor: isGenerating ? 'default' : 'pointer',
                            color: theme.text,
                            opacity: 0.7,
                            transition: 'opacity 0.15s',
                          }}
                          onMouseEnter={(e) => { if (!isGenerating) e.currentTarget.style.opacity = '1'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.7'; }}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  /* Message thread */
                  messages.map(msg => (
                    <ChatMessage
                      key={msg.id}
                      message={msg}
                      theme={theme}
                      onSaveAsSketch={handleSaveAsSketch}
                    />
                  ))
                )}
              </div>
            </div>

            {/* Input bar */}
            <ChatInput
              onSend={sendMessage}
              disabled={isGenerating}
              theme={theme}
            />
          </>
        )}
      </div>
    </div>
  );
}
