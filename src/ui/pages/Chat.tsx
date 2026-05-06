import { useState, useCallback, useRef, useEffect, useLayoutEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/AuthContext';
import { createSketch, getPublicSketches } from '../../lib/sketches';
import { uploadSketchSamples } from '../../lib/sampleStorage';
import { encodeWAV } from '../../engine/export/WAVEncoder';
import { getProfile } from '../../lib/profiles';
import { generateCode } from '../../lib/aiGenerate';
import { createFeedbackEntry, saveFeedback, updateFeedback } from '../../lib/feedbackStore';
import { createProvider, checkBudget } from '../../lib/aiProvider';
import { useTheme } from '../theme/ThemeContext';
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

/** Stop-words to strip from the trailing edge of an auto-generated title. */
const TITLE_TRAILING_STOPWORDS = new Set([
  'a', 'an', 'the', 'of', 'in', 'on', 'at', 'to', 'for',
  'with', 'and', 'or', 'but', 'into', 'over', 'under',
  'from', 'by', 'as', 'is', 'are', 'was', 'were',
]);

/**
 * Generate a clean sketch title from a free-form prompt.
 * Trims whitespace, walks back to the last word boundary so we never end
 * mid-word, drops dangling articles/prepositions, and capitalizes the first
 * letter. Falls back to 'Untitled sketch' when nothing useful is left.
 */
function cleanSketchTitle(prompt: string): string {
  const MAX = 60;
  let raw = prompt.trim();
  if (!raw) return 'Untitled sketch';

  if (raw.length > MAX) {
    raw = raw.slice(0, MAX);
    const lastSpace = raw.lastIndexOf(' ');
    if (lastSpace > 20) raw = raw.slice(0, lastSpace);
  }
  raw = raw.replace(/[\s.,;:!?\-—–]+$/g, '').trim();
  if (!raw) return 'Untitled sketch';

  // Drop dangling stop-words.
  let parts = raw.split(/\s+/);
  while (parts.length > 1 && TITLE_TRAILING_STOPWORDS.has(parts[parts.length - 1].toLowerCase())) {
    parts.pop();
  }
  raw = parts.join(' ');
  if (!raw) return 'Untitled sketch';

  return raw[0].toUpperCase() + raw.slice(1);
}

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

// Hand-crafted preset scripts for the example buttons. These bypass AI generation
// so the landing-page demos are instant, reliable, and high-quality.
const SUGGESTION_PRESETS: Record<string, string> = {
  'Forest at dawn': `group forest
volume 0.9
reverb wet 0.3 size 0.8 damping 0.6

    loop gen birds calling at dawn
        volume 0.4to0.6
        pitch 1.2to2.0
        move fly speed 1to5
        visual trail sphere
        color white

    3 * loop gen wind through forest leaves
        volume 0.2to0.4
        pitch 0.6to1.2
        move fly speed 1to3
        visual trail
        color blue

    loop gen distant forest stream babbling
        volume 0.15to0.25
        pitch 0.4to0.6
        move fly speed 0.5to1.5
        visual sphere
        color yellow
endgroup
`,
  'Rain on a tin roof': `group rain
volume 0.9
reverb wet 0.4 size 0.7 damping 0.7

    4 * loop gen rhythmic rain drops on tin roof
        volume 0.3to0.5
        pitch 0.9to1.3
        move fly speed 1to3
        visual trail
        color blue

    loop gen distant rolling thunder
        volume 0.2to0.4
        pitch 0.3to0.6
        move fly speed 0.3to0.8
        visual trail sphere
        color purple

    2 * loop gen quiet night crickets ambience
        volume 0.1to0.2
        pitch 1.0to1.4
        move fly speed 0.5to1.5
        visual sphere
        color green
endgroup
`,
  'Celestial choir': `group cosmos
volume 0.9
reverb wet 0.7 size 1.0 damping 0.2

    3 * loop gen ethereal celestial choir voices
        volume 0.3to0.5
        pitch 0.8to1.2
        move orbit speed 0.1to0.3
        visual trail sphere
        color white

    loop gen deep space drone ambience
        volume 0.2to0.3
        pitch 0.4to0.6
        move fly speed 0.2to0.5
        visual trail
        color purple
endgroup
`,
};

export function Chat() {
  const navigate = useNavigate();
  const { user, signInWithGitHub, signInWithGoogle } = useAuth();
  const { mode, theme, setMode } = useTheme();
  const { uiState, tracksRef, engine: engineRef, loadScript, play, stop, setListenerPosition, setListenerOrientation, setOnMissingBuffer, setOnSearchCommunity, setPreferCommunity } = useSatieEngine();
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
  const [savingSketchId, setSavingSketchId] = useState<string | null>(null);
  const [mouseLookActive, setMouseLookActive] = useState(false);
  const [showControlsToast, setShowControlsToast] = useState(false);
  const hasShownToast = useRef(false);

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
      // Show controls toast on first generation
      if (count > 0 && !hasShownToast.current) {
        hasShownToast.current = true;
        setShowControlsToast(true);
        setTimeout(() => setShowControlsToast(false), 6000);
      }
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

  // Auto-scroll on new messages — useLayoutEffect so we read scrollHeight
  // after the new message has been committed to the DOM.
  useLayoutEffect(() => {
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

  const sendPreset = useCallback((title: string, desc: string) => {
    if (isGenerating) return;
    const script = SUGGESTION_PRESETS[title];
    if (!script) {
      sendMessage(`${title.toLowerCase()} — ${desc}`);
      return;
    }
    if (!user) {
      setShowSignInPrompt(true);
      return;
    }
    stopBackgroundMusic();
    const prompt = `${title.toLowerCase()} — ${desc}`;
    const userId = nextId();
    const assistantId = nextId();
    setMessages(prev => [
      ...prev,
      { id: userId, role: 'user', content: prompt, status: 'done' },
      { id: assistantId, role: 'assistant', content: prompt, script, status: 'playing' as const },
    ]);
    setCurrentScript(script);
    loadScript(script);
    if (!uiState.isPlaying) play();
  }, [isGenerating, user, nextId, loadScript, play, uiState.isPlaying, sendMessage]);

  const handleSaveAsSketch = useCallback(async (script: string, prompt: string, messageId: string) => {
    if (!user) return;
    if (savingSketchId) return; // guard re-entry while upload is in flight
    setSavingSketchId(messageId);
    try {
      const title = cleanSketchTitle(prompt);
      const sketch = await createSketch(user.id, title, script);

      // Capture engine audio buffers (including gen audio) and upload as samples.
      // We await the upload so the editor can load samples from storage on mount —
      // otherwise the user lands on /editor/:id with silent audio.
      if (engineRef.current) {
        const engineBuffers = engineRef.current.getAudioBuffers();
        if (engineBuffers.size > 0) {
          const sampleMap = new Map<string, ArrayBuffer>();
          for (const [name, audioBuf] of engineBuffers) {
            const wavBlob = encodeWAV(audioBuf, 16);
            sampleMap.set(name, await wavBlob.arrayBuffer());
          }
          try {
            await uploadSketchSamples(user.id, sketch.id, sampleMap);
          } catch (e) {
            console.error('[Chat] Failed to upload samples:', e);
          }
        }
      }

      navigate(`/editor/${sketch.id}`);
    } catch (e: any) {
      console.error('Failed to save sketch:', e);
      setSavingSketchId(null);
    }
  }, [user, navigate, engineRef, savingSketchId]);

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

      {/* Controls toast — appears after first generation */}
      {showControlsToast && (
        <div style={{
          position: 'absolute',
          bottom: 100,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 10,
          background: `${theme.invertedBg}e6`,
          color: theme.invertedText,
          padding: '10px 20px',
          borderRadius: 10,
          fontSize: '13px',
          fontFamily: "'Inter', system-ui, sans-serif",
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          backdropFilter: 'blur(8px)',
          animation: 'satie-fade-in 0.4s ease',
          pointerEvents: 'auto',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
        onClick={() => setShowControlsToast(false)}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>
          <span>put on headphones</span>
          <span style={{ opacity: 0.4 }}>·</span>
          <span style={{ opacity: 0.7 }}>click + drag to look around · WASD to move</span>
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
                  opacity: 0.5,
                  margin: '0 0 8px',
                }}>
                  type what you want to hear — satie composes it in 3D space around you
                </p>
                <p style={{
                  fontSize: '13px',
                  opacity: 0.3,
                  margin: '0 0 28px',
                }}>
                  best with headphones
                </p>

                {/* Suggestion cards */}
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
                  <div style={{ width: '100%', fontSize: '12px', opacity: 0.35, marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
                    try one
                  </div>
                  {SUGGESTIONS.map(s => (
                    <button
                      key={s.title}
                      onClick={() => sendPreset(s.title, s.desc)}
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
                        opacity: 0.85,
                        transition: 'opacity 0.15s, transform 0.15s, border-color 0.15s',
                      }}
                      onMouseEnter={(e) => { if (!isGenerating) { sfx.hover(); e.currentTarget.style.opacity = '1'; e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.borderColor = `${theme.text}40`; } }}
                      onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.85'; e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.borderColor = theme.border; }}
                    >
                      <div style={{ fontWeight: 600, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ opacity: 0.5 }}>{s.icon(theme.text)}</span>
                        {s.title}
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={theme.text} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.3, marginLeft: 'auto' }}>
                          <path d="M5 12h14M12 5l7 7-7 7"/>
                        </svg>
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
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12, maxWidth: 680, width: '100%' }}>
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
                      onMouseEnter={(e) => { sfx.hover(); e.currentTarget.style.opacity = '0.9'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
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
                    onSaveAsSketch={(script, prompt) => handleSaveAsSketch(script, prompt, msg.id)}
                    savingSketch={savingSketchId === msg.id}
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
