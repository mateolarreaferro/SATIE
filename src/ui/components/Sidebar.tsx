import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/AuthContext';
import { useSFX } from '../hooks/useSFX';
import { useTheme } from '../theme/ThemeContext';
import { RADIUS } from '../theme/tokens';

export interface PanelVisibility {
  samples: boolean;
  voices: boolean;
  ai: boolean;
}

export type PopoverType = 'docs' | 'export' | 'versions' | null;

interface SidebarProps {
  isPlaying: boolean;
  currentTime: number;
  trackCount: number;
  onPlay: () => void;
  onStop: () => void;
  onMasterVolume: (vol: number) => void;
  panels: PanelVisibility;
  onTogglePanel: (panel: keyof PanelVisibility) => void;
  activePopover: PopoverType;
  onTogglePopover: (p: 'docs' | 'export' | 'versions') => void;
  onSave?: () => void;
  canSave?: boolean;
  /** True when there are unsaved changes — drives the save-button "active" glow. */
  isDirty?: boolean;
  isPublic?: boolean;
  onTogglePublic?: () => void;
  sketchId?: string;
}

export function Sidebar({
  isPlaying,
  currentTime,
  trackCount,
  onPlay,
  onStop,
  onMasterVolume,
  panels,
  onTogglePanel,
  activePopover,
  onTogglePopover,
  onSave,
  canSave,
  isDirty,
  isPublic,
  onTogglePublic,
  sketchId,
}: SidebarProps) {
  const { user, signInWithGitHub, signOut } = useAuth();
  const navigate = useNavigate();
  const sfx = useSFX();
  const { theme } = useTheme();

  const formatTime = (t: number) => {
    const mins = Math.floor(t / 60);
    const secs = Math.floor(t % 60);
    const ms = Math.floor((t % 1) * 100);
    return `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
  };

  const iconBtnStyle = (active: boolean): React.CSSProperties => ({
    width: 36,
    height: 30,
    background: active ? theme.accentBgSubtle : 'none',
    border: 'none',
    borderRadius: RADIUS.sm,
    cursor: 'pointer',
    color: theme.accent,
    opacity: active ? 0.95 : 0.5,
    padding: 0,
    transition: 'opacity 0.15s, background 0.15s',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  });

  const smallBtnStyle = (active?: boolean, disabled?: boolean): React.CSSProperties => ({
    width: 36,
    height: 28,
    background: active ? theme.accentBgSubtle : 'none',
    border: 'none',
    borderRadius: RADIUS.sm,
    cursor: disabled ? 'not-allowed' : 'pointer',
    color: theme.accent,
    opacity: disabled ? 0.2 : (active ? 0.95 : 0.5),
    padding: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'opacity 0.15s, background 0.15s',
  });

  const handleShareCopy = () => {
    if (!isPublic || !sketchId) return;
    navigator.clipboard.writeText(`${window.location.origin}/s/${sketchId}`);
    sfx.save();
  };

  return (
    <div style={{
      width: 72,
      height: '100vh',
      background: theme.cardBg,
      borderRight: `1.5px solid ${theme.cardBorder}`,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '16px 0',
      gap: '10px',
      fontFamily: "'Inter', system-ui, sans-serif",
      flexShrink: 0,
      position: 'relative',
      zIndex: 100,
    }}>
      {/* Logo */}
      <div
        onClick={() => navigate('/')}
        style={{
          fontSize: '16px',
          fontWeight: 700,
          color: theme.text,
          letterSpacing: '0.02em',
          marginBottom: '12px',
          writingMode: 'vertical-rl',
          textOrientation: 'mixed',
          transform: 'rotate(180deg)',
          cursor: 'pointer',
          opacity: 0.85,
        }}
      >
        satie
      </div>

      {/* Play/Stop */}
      <button
        className="sidebar-btn"
        onClick={() => { isPlaying ? (sfx.stop(), onStop()) : (sfx.play(), onPlay()); }}
        onMouseEnter={sfx.hover}
        title={isPlaying ? 'Stop' : 'Play'}
        aria-label={isPlaying ? 'Stop playback' : 'Play sketch'}
        aria-pressed={isPlaying}
        style={{
          width: 38,
          height: 38,
          background: 'none',
          border: '1.5px solid ' + (isPlaying ? theme.danger : theme.accent),
          borderRadius: isPlaying ? RADIUS.md : 19,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'all 0.15s',
          color: isPlaying ? theme.danger : theme.accent,
        }}
      >
        {isPlaying ? (
          <svg width="14" height="14" viewBox="0 0 10 10">
            <rect x="1.5" y="1.5" width="7" height="7" rx="1" fill="currentColor"/>
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 10 10">
            <polygon points="2.5,1 8.5,5 2.5,9" fill="currentColor"/>
          </svg>
        )}
      </button>

      {/* Time */}
      <div style={{
        fontSize: '11px',
        color: theme.text,
        opacity: 0.5,
        fontFamily: "'SF Mono', monospace",
        letterSpacing: '-0.3px',
        whiteSpace: 'nowrap',
      }}>
        {formatTime(currentTime)}
      </div>

      {/* Voices */}
      <div style={{
        fontSize: '11px',
        color: theme.text,
        opacity: 0.3,
        fontFamily: "'SF Mono', monospace",
      }}>
        {trackCount}v
      </div>

      {/* Volume */}
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        defaultValue={1}
        onChange={(e) => onMasterVolume(parseFloat(e.target.value))}
        title="Master volume"
        aria-label="Master volume"
        style={{
          width: 50,
          accentColor: theme.accent,
          opacity: 0.4,
          writingMode: 'vertical-lr',
          direction: 'rtl',
        }}
      />

      {/* ── Panels ── */}
      <div style={{
        marginTop: '4px',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        alignItems: 'center',
        paddingTop: '10px',
        borderTop: `1px solid ${theme.cardBorder}`,
      }}>
        {/* Samples */}
        <button
          className="sidebar-btn"
          onClick={() => { sfx.toggle(); onTogglePanel('samples'); }}
          onMouseEnter={sfx.hover}
          title={`${panels.samples ? 'Hide' : 'Show'} assets`}
          aria-label={`${panels.samples ? 'Hide' : 'Show'} assets panel`}
          aria-pressed={panels.samples}
          style={{ ...iconBtnStyle(panels.samples), flexDirection: 'column', height: 'auto', gap: 2, padding: '4px 0' }}
        >
          <svg width="16" height="16" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
            <path d="M3 1.5 L3 12.5 L11.5 12.5 L11.5 4.5 L8.5 1.5 Z" strokeLinejoin="round"/>
            <path d="M8.5 1.5 L8.5 4.5 L11.5 4.5" strokeLinejoin="round"/>
          </svg>
          <span style={{ fontSize: '9px', fontWeight: 500, letterSpacing: '0.02em' }}>samples</span>
        </button>

        {/* Voices */}
        <button
          className="sidebar-btn"
          onClick={() => { sfx.toggle(); onTogglePanel('voices'); }}
          onMouseEnter={sfx.hover}
          title={`${panels.voices ? 'Hide' : 'Show'} voices`}
          aria-label={`${panels.voices ? 'Hide' : 'Show'} voices panel`}
          aria-pressed={panels.voices}
          style={{ ...iconBtnStyle(panels.voices), flexDirection: 'column', height: 'auto', gap: 2, padding: '4px 0' }}
        >
          <svg width="16" height="16" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
            <line x1="2" y1="3.5" x2="12" y2="3.5" strokeLinecap="round"/>
            <line x1="2" y1="7" x2="12" y2="7" strokeLinecap="round"/>
            <line x1="2" y1="10.5" x2="12" y2="10.5" strokeLinecap="round"/>
          </svg>
          <span style={{ fontSize: '9px', fontWeight: 500, letterSpacing: '0.02em' }}>voices</span>
        </button>

        {/* AI */}
        <button
          className="sidebar-btn"
          onClick={() => { sfx.toggle(); onTogglePanel('ai'); }}
          onMouseEnter={sfx.hover}
          title={`${panels.ai ? 'Hide' : 'Show'} AI`}
          aria-label={`${panels.ai ? 'Hide' : 'Show'} AI panel`}
          aria-pressed={panels.ai}
          style={{ ...iconBtnStyle(panels.ai), flexDirection: 'column', height: 'auto', gap: 2, padding: '4px 0' }}
        >
          <svg width="16" height="16" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
            <path d="M7 1.5 C7 1.5 3 1.5 3 5 C3 7 4.5 7.5 4.5 9.5 L9.5 9.5 C9.5 7.5 11 7 11 5 C11 1.5 7 1.5 7 1.5 Z" strokeLinejoin="round"/>
            <line x1="5" y1="9.5" x2="5" y2="11.5" strokeLinecap="round"/>
            <line x1="9" y1="9.5" x2="9" y2="11.5" strokeLinecap="round"/>
            <path d="M5 11.5 Q7 13 9 11.5" strokeLinecap="round"/>
          </svg>
          <span style={{ fontSize: '9px', fontWeight: 500, letterSpacing: '0.02em' }}>AI</span>
        </button>
      </div>

      {/* ── Pop-ups ── */}
      <div style={{
        marginTop: '4px',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        alignItems: 'center',
        paddingTop: '10px',
        borderTop: `1px solid ${theme.cardBorder}`,
      }}>
        {/* Save — glows when there are unsaved changes */}
        {canSave && onSave && (
          <button
            className="sidebar-btn"
            onClick={() => { sfx.save(); onSave(); }}
            onMouseEnter={sfx.hover}
            title={isDirty ? 'Save sketch (unsaved changes)' : 'Saved'}
            aria-label={isDirty ? 'Save sketch' : 'All changes saved'}
            style={smallBtnStyle(isDirty)}
          >
            <svg width="18" height="18" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
              <path d="M2.5 1.5h7l2.5 2.5v8h-10v-10.5z" strokeLinejoin="round"/>
              <path d="M4.5 1.5v3h5v-3" strokeLinejoin="round"/>
              <rect x="4" y="8" width="6" height="3.5" rx="0.5"/>
            </svg>
          </button>
        )}

        {/* Public toggle — distinct icon for each state */}
        {canSave && onTogglePublic && (
          <button
            className="sidebar-btn"
            onClick={() => { sfx.toggle(); onTogglePublic(); }}
            onMouseEnter={sfx.hover}
            title={isPublic ? 'Make private' : 'Make public (shareable)'}
            aria-label={isPublic ? 'Make sketch private' : 'Make sketch public'}
            aria-pressed={!!isPublic}
            style={smallBtnStyle(isPublic)}
          >
            {isPublic ? (
              /* Globe with meridians — public */
              <svg width="18" height="18" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
                <circle cx="7" cy="7" r="5.5"/>
                <path d="M1.5 7 L12.5 7" strokeLinecap="round"/>
                <ellipse cx="7" cy="7" rx="2.5" ry="5.5"/>
              </svg>
            ) : (
              /* Closed padlock — private */
              <svg width="18" height="18" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
                <rect x="2.5" y="6" width="9" height="6.5" rx="1" strokeLinejoin="round"/>
                <path d="M4.5 6 V4 a2.5 2.5 0 0 1 5 0 V6" strokeLinejoin="round"/>
                <circle cx="7" cy="9" r="0.8" fill="currentColor" stroke="none"/>
              </svg>
            )}
          </button>
        )}

        {/* Share link — always shown when sketchId exists; disabled when private */}
        {canSave && sketchId && (
          <button
            className="sidebar-btn"
            onClick={isPublic ? handleShareCopy : undefined}
            onMouseEnter={sfx.hover}
            title={isPublic ? 'Copy share link' : 'Make public to share'}
            aria-label={isPublic ? 'Copy share link' : 'Sharing disabled — make sketch public first'}
            aria-disabled={!isPublic}
            disabled={!isPublic}
            style={smallBtnStyle(false, !isPublic)}
          >
            <svg width="18" height="18" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
              <path d="M5.5 8.5 L8.5 5.5" strokeLinecap="round"/>
              <path d="M6 9 C4.5 10.5 2.5 10.5 2 10 C1.5 9.5 1.5 7.5 3 6 L4.5 4.5" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M8 5 C9.5 3.5 11.5 3.5 12 4 C12.5 4.5 12.5 6.5 11 8 L9.5 9.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        )}

        {/* Export */}
        <button
          className="sidebar-btn"
          onClick={() => { sfx.toggle(); onTogglePopover('export'); }}
          onMouseEnter={sfx.hover}
          title={activePopover === 'export' ? 'Hide export' : 'Export audio'}
          aria-label="Toggle export panel"
          aria-pressed={activePopover === 'export'}
          style={smallBtnStyle(activePopover === 'export')}
        >
          <svg width="18" height="18" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
            <path d="M7 1.5 L7 9" strokeLinecap="round"/>
            <path d="M4 6.5 L7 9.5 L10 6.5" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M2 11.5 L12 11.5" strokeLinecap="round"/>
          </svg>
        </button>

        {/* Versions */}
        {canSave && (
          <button
            className="sidebar-btn"
            onClick={() => { sfx.toggle(); onTogglePopover('versions'); }}
            onMouseEnter={sfx.hover}
            title={activePopover === 'versions' ? 'Hide versions' : 'Version history'}
            aria-label="Toggle version history panel"
            aria-pressed={activePopover === 'versions'}
            style={smallBtnStyle(activePopover === 'versions')}
          >
            <svg width="18" height="18" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
              <circle cx="7" cy="7" r="5.5"/>
              <path d="M7 4 L7 7.5 L9.5 9" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        )}
      </div>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Docs — bottom of sidebar */}
      <button
        className="sidebar-btn"
        onClick={() => { sfx.toggle(); onTogglePopover('docs'); }}
        onMouseEnter={sfx.hover}
        title={activePopover === 'docs' ? 'Hide docs' : 'Language reference'}
        aria-label="Toggle docs panel"
        aria-pressed={activePopover === 'docs'}
        style={{
          width: 36,
          height: 36,
          background: 'none',
          border: activePopover === 'docs' ? `1px solid ${theme.accent}` : '1px solid transparent',
          borderRadius: 18,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '16px',
          fontWeight: 500,
          color: theme.accent,
          opacity: activePopover === 'docs' ? 0.95 : 0.5,
          fontFamily: "'SF Mono', monospace",
          transition: 'all 0.15s',
          marginBottom: '4px',
        }}
      >
        ?
      </button>

      {/* User avatar / sign in */}
      {user ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', marginBottom: '4px' }}>
          <button
            className="avatar-btn"
            onClick={() => { sfx.click(); navigate('/'); }}
            onMouseEnter={sfx.hover}
            title={`${user.email ?? user.user_metadata?.user_name}\nClick for dashboard`}
            aria-label={`Open dashboard (signed in as ${user.email ?? user.user_metadata?.user_name})`}
            style={{
              width: 36,
              height: 36,
              background: theme.accent,
              border: 'none',
              borderRadius: 18,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '16px',
              color: theme.accentText,
              fontWeight: 600,
              fontFamily: "'Inter', system-ui, sans-serif",
            }}
          >
            {(user.email?.[0] ?? user.user_metadata?.user_name?.[0] ?? '?').toUpperCase()}
          </button>
          <button
            onClick={() => { sfx.close(); signOut(); }}
            title="Sign out"
            aria-label="Sign out"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: '16px',
              fontFamily: "'SF Mono', monospace",
              color: theme.text,
              opacity: 0.4,
              padding: 0,
            }}
          >
            out
          </button>
        </div>
      ) : (
        <button
          className="sidebar-btn"
          onClick={() => { sfx.click(); signInWithGitHub(); }}
          onMouseEnter={sfx.hover}
          title="Sign in with GitHub"
          aria-label="Sign in with GitHub"
          style={{
            width: 36,
            height: 36,
            background: 'none',
            border: `1px solid ${theme.cardBorder}`,
            borderRadius: 18,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '16px',
            color: theme.accent,
            opacity: 0.5,
            marginBottom: '4px',
          }}
        >
          <svg width="18" height="18" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
            <circle cx="7" cy="5" r="3"/>
            <path d="M2 13c0-2.8 2.2-5 5-5s5 2.2 5 5" strokeLinecap="round"/>
          </svg>
        </button>
      )}
    </div>
  );
}
