import { useState, useCallback, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/AuthContext';
import { createSketch, getPublicSketches } from '../../lib/sketches';
import { getProfile } from '../../lib/profiles';
import { generateCode } from '../../lib/aiGenerate';
import { createFeedbackEntry, saveFeedback, updateFeedback } from '../../lib/feedbackStore';
import { createProvider, checkBudget } from '../../lib/aiProvider';
import { useDayNightCycle } from '../hooks/useDayNightCycle';
import { useSFX } from '../hooks/useSFX';
import { useSatieEngine } from '../hooks/useSatieEngine';
import { useBackgroundMusic, stopBackgroundMusic } from '../hooks/useBackgroundMusic';
import { RiverCanvas } from '../components/RiverCanvas';
import { SpatialViewport } from '../components/SpatialViewport';
import { ChatMessage, type ChatMessageData } from '../components/ChatMessage';
import { ChatInput } from '../components/ChatInput';
import { Header } from '../components/Header';
import type { Sketch, Profile } from '../../lib/supabase';
import { downloadCommunitySampleByName } from '../../lib/communitySamples';
import { findCommunityMatch } from '../../lib/communitySearch';
import { getPreferCommunitySamples } from '../../lib/userSettings';

const SUGGESTIONS = [
  { title: 'Forest at dawn', desc: 'birds calling, wind through leaves, a distant stream', icon: (c: string) => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 18a5 5 0 0 0-10 0" /><line x1="12" y1="9" x2="12" y2="2" /><line x1="4.22" y1="10.22" x2="5.64" y2="11.64" /><line x1="1" y1="18" x2="3" y2="18" /><line x1="21" y1="18" x2="23" y2="18" /><line x1="18.36" y1="11.64" x2="19.78" y2="10.22" /><line x1="23" y1="22" x2="1" y2="22" /></svg>
  )},
  { title: 'Rain on a tin roof', desc: 'rhythmic drops, distant thunder, night ambience', icon: (c: string) => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 17.58A5 5 0 0 0 18 8h-1.26A8 8 0 1 0 4 16.25" /><line x1="8" y1="16" x2="8.01" y2="16" /><line x1="8" y1="20" x2="8.01" y2="20" /><line x1="12" y1="18" x2="12.01" y2="18" /><line x1="12" y1="22" x2="12.01" y2="22" /><line x1="16" y1="16" x2="16.01" y2="16" /><line x1="16" y1="20" x2="16.01" y2="20" /></svg>
  )},
  { title: 'Celestial choir', desc: 'voices orbiting slowly through deep space', icon: (c: string) => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
  )},
];

export function Chat() {
  const navigate = useNavigate();
  const { user, signInWithGitHub, signInWithGoogle } = useAuth();
  const { mode, theme, setMode } = useDayNightCycle();
  const { uiState, tracksRef, loadScript, play, stop, setListenerPosition, setListenerOrientation, setOnMissingBuffer, setOnSearchCommunity, setPreferCommunity } = useSatieEngine();
  const sfx = useSFX();

  // Background music — plays until first prompt is sent
  useBackgroundMusic('/Satie-Theme.wav', 0.08);

  const [messages, setMessages] = useState<ChatMessageData[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentScript, setCurrentScript] = useState<string | null>(null);
  const [hasActiveTracks, setHasActiveTracks] = useState(false);
  const [featuredSketches, setFeaturedSketches] = useState<Sketch[]>([]);
  const [sketchAuthors, setSketchAuthors] = useState<Record<string, Profile>>({});
  const [showSignInPrompt, setShowSignInPrompt] = useState(false);
  const [mouseLookActive, setMouseLookActive] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const messageIdCounter = useRef(0);

  // Wire community sample resolution for lazy loading + community-first gen
  useEffect(() => {
    setOnMissingBuffer(async (clipName: string) => {
      const name = clipName.startsWith('community/') ? clipName.slice(10) : clipName;
      return downloadCommunitySampleByName(name);
    });
    setOnSearchCommunity((prompt: string) => findCommunityMatch(prompt));
    setPreferCommunity(getPreferCommunitySamples());
    return () => {
      setOnMissingBuffer(null);
      setOnSearchCommunity(null);
    };
  }, [setOnMissingBuffer, setOnSearchCommunity, setPreferCommunity]);

  // Track whether there are active tracks for conditional viewport mount
  useEffect(() => {
    const interval = setInterval(() => {
      const count = tracksRef.current?.length ?? 0;
      setHasActiveTracks(count > 0);
    }, 500);
    return () => clearInterval(interval);
  }, [tracksRef]);

  // Load featured public sketches + their author profiles
  useEffect(() => {
    getPublicSketches()
      .then(async (sketches) => {
        const featured = sketches.slice(0, 20);
        setFeaturedSketches(featured);
        // Fetch author profiles
        const uniqueUserIds = [...new Set(featured.map(s => s.user_id))];
        const profiles: Record<string, Profile> = {};
        await Promise.all(uniqueUserIds.map(async (uid) => {
          try {
            const p = await getProfile(uid);
            if (p) profiles[uid] = p;
          } catch { /* ok */ }
        }));
        setSketchAuthors(profiles);
      })
      .catch(console.error);
  }, []);

  // Listen for mouse-look toggle from FPS controls
  const cursorStyleRef = useRef<HTMLStyleElement | null>(null);
  useEffect(() => {
    const handler = (e: Event) => {
      const locked = (e as CustomEvent).detail;
      setMouseLookActive(locked);
      sfx.toggle();
      // Hide/show cursor via injected style (overrides all elements)
      if (locked) {
        if (!cursorStyleRef.current) {
          const style = document.createElement('style');
          style.textContent = '* { cursor: none !important; }';
          document.head.appendChild(style);
          cursorStyleRef.current = style;
        }
      } else {
        cursorStyleRef.current?.remove();
        cursorStyleRef.current = null;
      }
    };
    window.addEventListener('satie-mouselook', handler);
    return () => {
      window.removeEventListener('satie-mouselook', handler);
      cursorStyleRef.current?.remove();
      cursorStyleRef.current = null;
    };
  }, [sfx]);

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

    // If not signed in, show sign-in prompt instead of blocking
    if (!user) {
      setShowSignInPrompt(true);
      return;
    }

    // Validate that a provider is available (credits or API key)
    try {
      createProvider();
    } catch {
      const errId = nextId();
      setMessages(prev => [
        ...prev,
        { id: nextId(), role: 'user', content: prompt, status: 'done' },
        { id: errId, role: 'assistant', content: '', status: 'error', error: 'No credits or API key configured. Click the wallet icon above to add credits or your own API key.' },
      ]);
      return;
    }

    // Budget guard — block if session cost exceeds budget
    const budget = checkBudget();
    if (budget.over) {
      const errId = nextId();
      setMessages(prev => [
        ...prev,
        { id: nextId(), role: 'user', content: prompt, status: 'done' },
        { id: errId, role: 'assistant', content: '', status: 'error', error: `Session budget reached ($${(budget.currentCents / 100).toFixed(2)} / $${(budget.budgetCents / 100).toFixed(2)}). Refresh page to reset.` },
      ]);
      return;
    }

    setShowSignInPrompt(false);
    // Stop background music on first generation
    stopBackgroundMusic();
    const userId = nextId();
    const assistantId = nextId();

    setMessages(prev => [
      ...prev,
      { id: userId, role: 'user', content: prompt, status: 'done' },
      { id: assistantId, role: 'assistant', content: prompt, status: 'generating' },
    ]);
    setIsGenerating(true);

    try {
      // Build lightweight conversation history — only user prompts and short
      // script summaries (NOT full scripts, which inflate tokens massively).
      // The current script is already sent via buildEnrichedPrompt, so we only
      // need enough history for the model to understand iterative refinement.
      const history = messages
        .filter(m => m.status !== 'error' && m.status !== 'generating')
        .slice(-6)  // last 3 pairs max
        .map(m => ({
          role: m.role,
          content: m.role === 'assistant'
            ? `[generated ${(m.script ?? '').split('\n').length} line script]`
            : m.content,
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

      // Save to RLHF feedback store
      const fb = createFeedbackEntry(prompt, result.code, 'script');
      saveFeedback(fb);

      const costStr = result.costCents > 0 ? ` · $${(result.costCents / 100).toFixed(4)}` : '';
      setMessages(prev => prev.map(m =>
        m.id === assistantId
          ? { ...m, script: result.code, status: 'playing' as const, error: result.error ? `${result.error}${costStr}` : (costStr ? costStr.trim() : undefined), feedbackId: fb.id }
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
  }, [isGenerating, user, messages, currentScript, loadScript, play, uiState.isPlaying, nextId]);

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

  const handleRate = useCallback((messageId: string, rating: 1 | -1) => {
    setMessages(prev => prev.map(m => {
      if (m.id !== messageId || !m.feedbackId) return m;
      const newRating = m.rating === rating ? 0 : rating;
      updateFeedback(m.feedbackId, { rating: newRating });
      return { ...m, rating: newRating };
    }));
  }, []);

  const handleScriptEdit = useCallback((messageId: string, newScript: string) => {
    // Update the message's script
    setMessages(prev => prev.map(m =>
      m.id === messageId ? { ...m, script: newScript } : m
    ));
    // Update current script and reload engine
    setCurrentScript(newScript);
    loadScript(newScript);
    if (!uiState.isPlaying) play();
  }, [loadScript, play, uiState.isPlaying]);

  const handleStop = useCallback(() => {
    stop();
    setHasActiveTracks(false);
  }, [stop]);

  const isEmpty = messages.length === 0;

  // Stop button for header
  const stopButton = uiState.isPlaying ? (
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
        display: 'flex',
        alignItems: 'center',
        gap: 5,
      }}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill={theme.text} stroke="none">
        <rect x="4" y="4" width="16" height="16" rx="2" />
      </svg>
      stop
    </button>
  ) : undefined;

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

      {/* Layer 2: 3D viewport overlay */}
      {hasActiveTracks && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 1 }}>
          <SpatialViewport tracksRef={tracksRef} overlayMode onListenerMove={setListenerPosition} onListenerRotate={setListenerOrientation} />
        </div>
      )}

      {/* Layer 3: Chat UI */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 2, display: 'flex', flexDirection: 'column', pointerEvents: 'none' }}>
        <Header theme={theme} mode={mode} setMode={setMode} rightExtra={stopButton} />

        {isEmpty ? (
          /* ── Landing state: hero → input → community (scroll-down sections) ── */
          <div style={{
            flex: 1,
            overflow: 'auto',
            display: 'flex',
            flexDirection: 'column',
            pointerEvents: 'auto',
          }}>
            {/* First viewport — hero + input fills the screen */}
            <div style={{
              minHeight: '100%',
              display: 'flex',
              flexDirection: 'column',
              flexShrink: 0,
            }}>
            {/* Hero + suggestions — vertically centered */}
            <div style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
              padding: '24px 24px 0',
              minHeight: 0,
            }}>
              <div style={{ textAlign: 'center', width: '100%', maxWidth: 680 }}>
                <h1 style={{
                  fontSize: '42px',
                  fontWeight: 700,
                  letterSpacing: '-0.01em',
                  lineHeight: 1.15,
                  margin: '0 0 12px',
                }}>
                  describe a 3D soundscape
                </h1>
                <p style={{
                  fontSize: '16px',
                  opacity: 0.4,
                  margin: '0 0 28px',
                }}>
                  satie turns your words into spatial audio you can explore
                </p>

                {/* Suggestion cards */}
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
                  {SUGGESTIONS.map(s => (
                    <button
                      key={s.title}
                      onClick={() => sendMessage(`${s.title.toLowerCase()} — ${s.desc}`)}
                      disabled={isGenerating}
                      style={{
                        padding: '12px 18px',
                        fontSize: '14px',
                        fontFamily: "'Inter', system-ui, sans-serif",
                        background: `${theme.cardBg}cc`,
                        backdropFilter: 'blur(12px)',
                        border: `1px solid ${theme.border}`,
                        borderRadius: 12,
                        cursor: isGenerating ? 'default' : 'pointer',
                        color: theme.text,
                        textAlign: 'left',
                        maxWidth: 200,
                        opacity: 0.8,
                        transition: 'opacity 0.15s, transform 0.15s',
                      }}
                      onMouseEnter={(e) => { if (!isGenerating) { e.currentTarget.style.opacity = '1'; e.currentTarget.style.transform = 'translateY(-2px)'; } }}
                      onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.8'; e.currentTarget.style.transform = 'translateY(0)'; }}
                    >
                      <div style={{ fontWeight: 600, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ opacity: 0.5 }}>{s.icon(theme.text)}</span>
                        {s.title}
                      </div>
                      <div style={{ fontSize: '13px', opacity: 0.5, lineHeight: 1.3 }}>{s.desc}</div>
                    </button>
                  ))}
                </div>

                {/* Sign-in prompt — shown when unauthenticated user tries to generate */}
                {showSignInPrompt && !user && (
                  <div style={{
                    marginTop: 20,
                    padding: '14px 22px',
                    background: `${theme.cardBg}dd`,
                    backdropFilter: 'blur(12px)',
                    border: `1px solid ${theme.border}`,
                    borderRadius: 12,
                    display: 'inline-flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 10,
                  }}>
                    <span style={{ fontSize: '15px', opacity: 0.6 }}>
                      Sign in to create your first soundscape
                    </span>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={signInWithGitHub} style={{
                        padding: '7px 18px',
                        fontSize: '14px',
                        fontFamily: "'Inter', system-ui, sans-serif",
                        background: theme.invertedBg,
                        color: theme.invertedText,
                        border: 'none',
                        borderRadius: 8,
                        cursor: 'pointer',
                        fontWeight: 500,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                      }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill={theme.invertedText}><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" /></svg>
                        GitHub
                      </button>
                      <button onClick={signInWithGoogle} style={{
                        padding: '7px 18px',
                        fontSize: '14px',
                        fontFamily: "'Inter', system-ui, sans-serif",
                        background: 'none',
                        border: `1px solid ${theme.text}60`,
                        color: theme.text,
                        borderRadius: 8,
                        cursor: 'pointer',
                        fontWeight: 500,
                      }}>
                        Google
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Input bar — pinned below hero */}
            <ChatInput
              onSend={sendMessage}
              disabled={isGenerating}
              theme={theme}
            />

            {/* Scroll-down indicator */}
            {featuredSketches.length > 0 && (
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                padding: '16px 0 20px',
                opacity: 0.25,
                animation: 'satie-bounce 2s ease-in-out infinite',
                pointerEvents: 'auto',
                cursor: 'pointer',
              }}
              onClick={() => {
                const el = document.getElementById('community-section');
                el?.scrollIntoView({ behavior: 'smooth' });
              }}
              >
                <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600, marginBottom: 6 }}>
                  explore community sketches
                </div>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={theme.text} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </div>
            )}
            </div>

            {/* Community section — second "page", scroll down to reveal */}
            {featuredSketches.length > 0 && (
              <div id="community-section" style={{
                flexShrink: 0,
                padding: '60px 24px 80px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                pointerEvents: 'auto',
              }}>
                <div style={{ fontSize: '12px', opacity: 0.25, marginBottom: 24, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600 }}>
                  from the community
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, maxWidth: 720, width: '100%' }}>
                  {featuredSketches.map(sketch => (
                    <button
                      key={sketch.id}
                      onClick={() => navigate(`/s/${sketch.id}`)}
                      style={{
                        padding: '10px 16px',
                        fontSize: '14px',
                        fontFamily: "'Inter', system-ui, sans-serif",
                        background: `${theme.cardBg}88`,
                        backdropFilter: 'blur(8px)',
                        border: `1px solid ${theme.border}`,
                        borderRadius: 10,
                        cursor: 'pointer',
                        color: theme.text,
                        textAlign: 'left',
                        width: '100%',
                        opacity: 0.6,
                        transition: 'opacity 0.15s, transform 0.15s',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.9'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.6'; e.currentTarget.style.transform = 'translateY(0)'; }}
                    >
                      <div style={{ fontWeight: 500, fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 5 }}>
                        {/* Play icon */}
                        <svg width="11" height="11" viewBox="0 0 24 24" fill={theme.text} stroke="none" style={{ opacity: 0.4, flexShrink: 0 }}>
                          <polygon points="5 3 19 12 5 21 5 3" />
                        </svg>
                        {sketch.title || 'untitled'}
                      </div>
                      <div style={{ fontSize: '12px', opacity: 0.35, marginTop: 3, display: 'flex', alignItems: 'center', gap: 6 }}>
                        {sketchAuthors[sketch.user_id] && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={theme.text} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                              <circle cx="12" cy="7" r="4" />
                            </svg>
                            {sketchAuthors[sketch.user_id].username}
                          </span>
                        )}
                        {(sketch.like_count ?? 0) > 0 && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={theme.text} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                            </svg>
                            {sketch.like_count}
                          </span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          /* ── Active conversation state ── */
          <>
            <div
              ref={scrollRef}
              style={{
                flex: 1,
                overflow: 'auto',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'flex-start',
                padding: '24px 24px 0',
                pointerEvents: 'auto',
              }}
            >
              <div style={{
                width: '100%',
                maxWidth: 680,
                margin: '0 auto',
              }}>
                {messages.map(msg => (
                  <ChatMessage
                    key={msg.id}
                    message={msg}
                    theme={theme}
                    onSaveAsSketch={handleSaveAsSketch}
                    onRate={handleRate}
                    onScriptEdit={handleScriptEdit}
                  />
                ))}
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

        {/* Controls hint — visible when 3D viewport is active */}
        {hasActiveTracks && (
          <div style={{
            position: 'absolute',
            bottom: 16,
            left: 20,
            pointerEvents: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            opacity: 0.3,
            fontFamily: "'Inter', system-ui, sans-serif",
            fontSize: '11px',
            color: theme.text,
          }}>
            {/* Click to toggle look — lock/unlock icon */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              {mouseLookActive ? (
                /* Locked — eye icon */
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={theme.text} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              ) : (
                /* Unlocked — eye-off icon */
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={theme.text} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                  <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              )}
              <span>click to {mouseLookActive ? 'unlock' : 'look'}</span>
            </div>
            <span style={{ opacity: 0.4 }}>·</span>
            {/* WASD */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={theme.text} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="5 15 12 8 19 15" />
              </svg>
              <span style={{ fontFamily: "'SF Mono', monospace", fontSize: '10px', fontWeight: 600, letterSpacing: '0.05em' }}>WASD</span>
              <span>move</span>
            </div>
            <span style={{ opacity: 0.4 }}>·</span>
            {/* Q/E fly */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={theme.text} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="19" x2="12" y2="5" />
                <polyline points="5 12 12 5 19 12" />
              </svg>
              <span style={{ fontFamily: "'SF Mono', monospace", fontSize: '10px', fontWeight: 600, letterSpacing: '0.05em' }}>QE</span>
              <span>fly</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
