import { useState, useCallback, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../lib/AuthContext';
import { loadSettings, saveKey as saveSettingsKey, getPreferCommunitySamples, setPreferCommunitySamples } from '../../lib/userSettings';
import { useSFX } from '../hooks/useSFX';
import { useMusicEnabled } from '../hooks/useBackgroundMusic';
import { FeedbackDashboard } from './FeedbackDashboard';
import type { Theme, ThemeMode } from '../theme/tokens';

interface ApiKeys {
  anthropic_key: string;
  elevenlabs_key: string;
  openai_key: string;
  gemini_key: string;
}

// ── Inline SVG icons (no external library) ──

const Icons = {
  sparkle: (color: string, size = 14) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4" />
    </svg>
  ),
  compass: (color: string, size = 14) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" fill={color} stroke="none" />
    </svg>
  ),
  folder: (color: string, size = 14) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  ),
  wallet: (color: string, size = 15) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="6" width="20" height="14" rx="2" />
      <path d="M2 10h20" />
      <circle cx="17" cy="14" r="1.5" fill={color} stroke="none" />
    </svg>
  ),
  sun: (color: string, size = 14) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  ),
  moon: (color: string, size = 14) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  ),
  sunset: (color: string, size = 14) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 18a5 5 0 0 0-10 0" />
      <line x1="12" y1="9" x2="12" y2="2" />
      <line x1="4.22" y1="10.22" x2="5.64" y2="11.64" />
      <line x1="1" y1="18" x2="3" y2="18" />
      <line x1="21" y1="18" x2="23" y2="18" />
      <line x1="18.36" y1="11.64" x2="19.78" y2="10.22" />
      <line x1="23" y1="22" x2="1" y2="22" />
    </svg>
  ),
  logOut: (color: string, size = 14) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  ),
  key: (color: string, size = 14) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.78 7.78 5.5 5.5 0 0 1 7.78-7.78zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
    </svg>
  ),
  speaker: (color: string, size = 14) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    </svg>
  ),
  speakerOff: (color: string, size = 14) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <line x1="23" y1="9" x2="17" y2="15" />
      <line x1="17" y1="9" x2="23" y2="15" />
    </svg>
  ),
  github: (color: string, size = 15) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
    </svg>
  ),
};

const themeIcons: Record<ThemeMode, (color: string) => React.ReactNode> = {
  light: (c) => Icons.sun(c, 13),
  fade: (c) => Icons.sunset(c, 13),
  dark: (c) => Icons.moon(c, 13),
  // 'system' uses the same sunset glyph so the affordance reads naturally —
  // most callers don't expose system mode, this is a defensive fallback.
  system: (c) => Icons.sunset(c, 13),
};

interface HeaderProps {
  theme: Theme;
  mode: ThemeMode;
  setMode: (m: ThemeMode) => void;
  /** Extra element rendered in the right section (e.g. stop button) */
  rightExtra?: React.ReactNode;
}

export function Header({ theme, mode, setMode, rightExtra }: HeaderProps) {
  const { user, signInWithGitHub, signInWithGoogle, signOut } = useAuth();
  const location = useLocation();
  const sfx = useSFX();

  const [musicOn, setMusicOn] = useMusicEnabled();
  const [showSettings, setShowSettings] = useState(false);
  const [keys, setKeys] = useState<ApiKeys>({ anthropic_key: '', elevenlabs_key: '', openai_key: '', gemini_key: '' });
  const [balanceCents, setBalanceCents] = useState<number | null>(null);
  const [advancedTab, setAdvancedTab] = useState<'keys' | 'learning'>('keys');
  const [addingCredits, setAddingCredits] = useState(false);
  const [preferCommunity, setPreferCommunityLocal] = useState(() => getPreferCommunitySamples());

  const setPreferCommunityState = useCallback((value: boolean) => {
    setPreferCommunityLocal(value);
    setPreferCommunitySamples(value);
  }, []);

  const userName = user?.user_metadata?.user_name || user?.email?.split('@')[0] || '';

  // Determine active page from path
  const path = location.pathname;
  const activePage = path === '/' ? 'create'
    : path === '/sketches' ? 'sketches'
    : path.startsWith('/explore') ? 'explore'
    : path.startsWith('/library') ? 'library'
    : null;

  // Load API keys
  useEffect(() => {
    loadSettings(user?.id ?? null).then(setKeys).catch(console.error);
  }, [user?.id]);

  // Load credit balance
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const { supabase: sb } = await import('../../lib/supabase');
        const { data: { session } } = await sb.auth.getSession();
        if (!session) return;
        const res = await fetch('/api/stripe/status', {
          headers: { 'Authorization': `Bearer ${session.access_token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setBalanceCents(data.balance_cents ?? 0);
        }
      } catch { /* proxy not deployed yet */ }
    })();
  }, [user]);

  const handleAddCredits = useCallback(async (amount: number) => {
    setAddingCredits(true);
    try {
      const { supabase: sb } = await import('../../lib/supabase');
      const { data: { session } } = await sb.auth.getSession();
      if (!session) throw new Error('Sign in required');
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ amount }),
      });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
      else throw new Error(data.error || 'Failed');
    } catch (e: any) {
      alert(e.message);
    } finally {
      setAddingCredits(false);
    }
  }, []);

  const handleSaveKey = useCallback((field: keyof ApiKeys, value: string) => {
    setKeys(prev => ({ ...prev, [field]: value }));
    saveSettingsKey(user?.id ?? null, field, value);
  }, [user?.id]);

  const tabs: { key: string; label: string; to: string; icon: (color: string) => React.ReactNode }[] = [
    { key: 'create', label: 'create', to: '/', icon: (c) => Icons.sparkle(c, 13) },
    { key: 'explore', label: 'explore', to: '/explore', icon: (c) => Icons.compass(c, 13) },
    { key: 'library', label: 'library', to: '/library', icon: (c) => (
      <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
      </svg>
    ) },
  ];

  return (
    <>
      <header style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '14px 32px',
        borderBottom: `1px solid ${theme.border}`,
        flexShrink: 0,
        pointerEvents: 'auto',
        zIndex: 10,
      }}>
        {/* Left — Logo */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
          <Link
            to="/"
            className="header-link"
            onMouseEnter={sfx.hover}
            onClick={sfx.click}
            style={{
              textDecoration: 'none',
              color: theme.text,
              fontSize: '22px',
              fontWeight: 700,
              letterSpacing: '0.06em',
            }}
          >
            satie
          </Link>
        </div>

        {/* Center — Tabs with icons */}
        <nav style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {tabs.map(tab => {
            const isActive = activePage === tab.key;
            return (
              <Link
                key={tab.key}
                to={tab.to}
                className="header-link"
                onMouseEnter={sfx.hover}
                onClick={sfx.click}
                style={{
                  textDecoration: 'none',
                  fontSize: '14px',
                  fontFamily: "'Inter', system-ui, sans-serif",
                  fontWeight: isActive ? 600 : 400,
                  color: theme.text,
                  padding: '5px 14px',
                  borderRadius: 6,
                  background: isActive ? `${theme.text}0a` : 'transparent',
                  opacity: isActive ? 1 : 0.35,
                  transition: 'all 0.2s',
                  letterSpacing: '0.02em',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                {tab.icon(theme.text)}
                {tab.label}
              </Link>
            );
          })}
          {/* Sketches tab — only visible when logged in */}
          {user && (
            <Link
              to="/sketches"
              className="header-link"
              onMouseEnter={sfx.hover}
              onClick={sfx.click}
              style={{
                textDecoration: 'none',
                fontSize: '14px',
                fontFamily: "'Inter', system-ui, sans-serif",
                fontWeight: activePage === 'sketches' ? 600 : 400,
                color: theme.text,
                padding: '5px 14px',
                borderRadius: 6,
                background: activePage === 'sketches' ? `${theme.text}0a` : 'transparent',
                opacity: activePage === 'sketches' ? 1 : 0.35,
                transition: 'all 0.2s',
                letterSpacing: '0.02em',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              {Icons.folder(theme.text, 13)}
              sketches
            </Link>
          )}
        </nav>

        {/* Right — user controls */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10 }}>
          {/* Theme toggle — icon buttons */}
          <div style={{ display: 'flex', gap: 2, marginRight: 2 }}>
            {(['light', 'fade', 'dark'] as ThemeMode[]).map(m => (
              <button
                key={m}
                className="theme-toggle-btn"
                onClick={() => { sfx.click(); setMode(m); }}
                onMouseEnter={sfx.hover}
                title={m}
                style={{
                  padding: 4,
                  background: mode === m ? theme.invertedBg : 'transparent',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                  opacity: mode === m ? 0.8 : 0.15,
                  transition: 'all 0.2s',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {themeIcons[m](mode === m ? theme.invertedText : theme.text)}
              </button>
            ))}
          </div>

          {/* Music toggle */}
          <button
            className="theme-toggle-btn"
            onClick={() => { sfx.click(); setMusicOn(!musicOn); }}
            onMouseEnter={sfx.hover}
            title={musicOn ? 'Mute music' : 'Play music'}
            style={{
              padding: 4,
              background: musicOn ? theme.invertedBg : 'transparent',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              opacity: musicOn ? 0.8 : 0.15,
              transition: 'all 0.2s',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginRight: 2,
            }}
          >
            {musicOn
              ? Icons.speaker(theme.invertedText, 13)
              : Icons.speakerOff(theme.text, 13)
            }
          </button>

          {rightExtra}

          {user ? (
            <>
              {/* Settings/wallet button */}
              <button
                className="settings-icon-btn"
                onClick={() => { sfx.toggle(); setShowSettings(!showSettings); }}
                onMouseEnter={sfx.hover}
                title="Account & Credits"
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 4,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: showSettings ? 0.8 : 0.35,
                  transition: 'opacity 0.15s',
                }}
              >
                {Icons.wallet(theme.text)}
              </button>

              {/* User avatar */}
              <div
                style={{
                  width: 32,
                  height: 32,
                  background: theme.text,
                  borderRadius: 16,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '14px',
                  color: theme.invertedText,
                  fontWeight: 600,
                }}
                title={user.email ?? userName}
              >
                {(userName[0] ?? '?').toUpperCase()}
              </div>

              {/* Sign out */}
              <button
                className="link-btn signout-btn"
                onClick={() => { sfx.click(); signOut(); }}
                onMouseEnter={sfx.hover}
                title="Sign out"
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 4,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: 0.25,
                  transition: 'opacity 0.15s',
                }}
              >
                {Icons.logOut(theme.text)}
              </button>
            </>
          ) : (
            <button
              className="auth-btn"
              onClick={() => { sfx.click(); signInWithGitHub(); }}
              onMouseEnter={sfx.hover}
              style={{
                padding: '6px 16px',
                background: theme.invertedBg,
                color: theme.invertedText,
                border: 'none',
                borderRadius: 8,
                cursor: 'pointer',
                fontSize: '14px',
                fontFamily: "'Inter', system-ui, sans-serif",
                fontWeight: 500,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              {Icons.github(theme.invertedText)}
              Sign in
            </button>
          )}
        </div>
      </header>

      {/* Settings panel — slides below header */}
      {showSettings && (
        <div style={{
          borderBottom: `1px solid ${theme.border}`,
          background: theme.bg,
          flexShrink: 0,
          overflowX: 'auto' as const,
          pointerEvents: 'auto',
          zIndex: 10,
        }}>
          <div style={{ padding: '14px 32px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 32 }}>
              {/* Credits — left side */}
              {user ? (
                <div>
                  <div style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 6,
                    marginBottom: 10,
                  }}>
                    <span style={{
                      fontSize: '18px',
                      fontWeight: 700,
                      fontFamily: "'SF Mono', monospace",
                      color: theme.text,
                    }}>
                      {balanceCents != null ? `$${(balanceCents / 100).toFixed(2)}` : '—'}
                    </span>
                    <span style={{ fontSize: '15px', opacity: 0.35 }}>credits</span>
                    {balanceCents != null && balanceCents < 100 && balanceCents >= 0 && (
                      <span style={{ fontSize: '16px', color: theme.danger, opacity: 0.8 }}>
                        {balanceCents === 0 ? 'empty' : 'running low'}
                      </span>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {[5, 10, 20, 50].map(amt => (
                      <button
                        key={amt}
                        className="credits-btn"
                        onClick={() => { sfx.click(); handleAddCredits(amt); }}
                        onMouseEnter={sfx.hover}
                        disabled={addingCredits}
                        style={{
                          padding: '4px 12px',
                          borderRadius: 6,
                          fontSize: '16px',
                          fontWeight: 600,
                          fontFamily: "'Inter', system-ui, sans-serif",
                          background: theme.invertedBg,
                          color: theme.invertedText,
                          border: 'none',
                          cursor: addingCredits ? 'wait' : 'pointer',
                          opacity: addingCredits ? 0.5 : 1,
                          transition: 'background 0.3s, color 0.3s',
                        }}
                      >
                        +${amt}
                      </button>
                    ))}
                  </div>

                  <div style={{ fontSize: '16px', opacity: 0.25, marginTop: 6, lineHeight: 1.4 }}>
                    Credits are used for AI script generation and audio synthesis.
                    <br />The editor, playback, export, and sharing are always free.
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: '15px', opacity: 0.4, lineHeight: 1.4 }}>
                  Sign in to add credits for AI and audio generation.
                </div>
              )}

              {/* Community-first toggle */}
              {user && (
                <div style={{ marginTop: 10 }}>
                  <label style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    cursor: 'pointer',
                    fontSize: '15px',
                    opacity: 0.5,
                    fontFamily: "'Inter', system-ui, sans-serif",
                  }}>
                    <input
                      type="checkbox"
                      checked={preferCommunity}
                      onChange={(e) => {
                        sfx.click();
                        setPreferCommunityState(e.target.checked);
                      }}
                      style={{ accentColor: theme.accent }}
                    />
                    Prefer community samples over AI generation
                  </label>
                </div>
              )}

              {/* Advanced — far right */}
              <div style={{ flexShrink: 0, marginLeft: 'auto', maxWidth: 420 }}>
                <div style={{
                  fontSize: '11px',
                  fontWeight: 500,
                  opacity: 0.2,
                  textTransform: 'uppercase' as const,
                  letterSpacing: '0.1em',
                  fontFamily: "'Inter', system-ui, sans-serif",
                  textAlign: 'right',
                  marginBottom: 8,
                  color: theme.text,
                }}>
                  Advanced
                </div>

                {/* Tab bar */}
                <div style={{
                  display: 'flex',
                  gap: 4,
                  marginBottom: 12,
                  justifyContent: 'flex-end',
                }}>
                  {([
                    { key: 'keys' as const, label: 'API keys', icon: Icons.key(advancedTab === 'keys' ? theme.accentText : theme.text, 11) },
                    { key: 'learning' as const, label: 'AI learning', icon: (
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={advancedTab === 'learning' ? theme.accentText : theme.text} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                      </svg>
                    )},
                  ]).map(tab => (
                    <button
                      key={tab.key}
                      onClick={() => setAdvancedTab(tab.key)}
                      style={{
                        padding: '2px 8px',
                        background: advancedTab === tab.key ? theme.accent : 'none',
                        color: advancedTab === tab.key ? theme.accentText : theme.accent,
                        border: `1px solid ${advancedTab === tab.key ? theme.accent : theme.cardBorder}`,
                        borderRadius: 6,
                        cursor: 'pointer',
                        fontSize: '12px',
                        fontFamily: "'Inter', system-ui, sans-serif",
                        fontWeight: 500,
                        letterSpacing: '0.02em',
                        transition: 'all 0.15s',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5,
                      }}
                    >
                      {tab.icon}
                      {tab.label}
                    </button>
                  ))}
                </div>

                {/* Tab content */}
                {advancedTab === 'keys' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {([
                      { label: 'Anthropic', field: 'anthropic_key' as const, placeholder: 'sk-ant-...' },
                      { label: 'OpenAI', field: 'openai_key' as const, placeholder: 'sk-...' },
                      { label: 'Gemini', field: 'gemini_key' as const, placeholder: 'AIza...' },
                      { label: 'ElevenLabs', field: 'elevenlabs_key' as const, placeholder: 'sk_...' },
                    ]).map(({ label, field, placeholder }) => (
                      <div key={field} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{
                          fontSize: '12px',
                          opacity: 0.4,
                          textTransform: 'uppercase' as const,
                          letterSpacing: '0.05em',
                          whiteSpace: 'nowrap' as const,
                          width: 80,
                          textAlign: 'right',
                          fontFamily: "'Inter', system-ui, sans-serif",
                        }}>
                          {label}
                        </div>
                        <input
                          type="password"
                          placeholder={placeholder}
                          value={keys[field]}
                          onChange={(e) => handleSaveKey(field, e.target.value)}
                          style={{
                            flex: 1,
                            padding: '4px 8px',
                            border: `1px solid ${theme.border}`,
                            borderRadius: 6,
                            fontSize: '13px',
                            fontFamily: "'SF Mono', monospace",
                            background: 'transparent',
                            outline: 'none',
                            color: theme.text,
                          }}
                        />
                      </div>
                    ))}
                    <div style={{ fontSize: '11px', opacity: 0.2, marginTop: 2, textAlign: 'right' }}>
                      Bypass credits — direct API calls, no limits.
                    </div>
                  </div>
                )}

                {advancedTab === 'learning' && (
                  <FeedbackDashboard theme={theme} />
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
