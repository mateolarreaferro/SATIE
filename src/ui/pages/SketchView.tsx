import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/AuthContext';
import { getPublicSketch, forkSketch, updateSketch } from '../../lib/sketches';
import { likeSketch, unlikeSketch, hasUserLiked } from '../../lib/likes';
import { getProfile } from '../../lib/profiles';
import { loadSketchSamples } from '../../lib/sampleStorage';
import { useSatieEngine } from '../hooks/useSatieEngine';
import { useFaceTracking } from '../hooks/useFaceTracking';
import { SpatialViewport } from '../components/SpatialViewport';
import { ControlsHint } from '../components/ControlsHint';
import { SatieEditor } from '../components/SatieEditor';
import { Header } from '../components/Header';
import { Button, IconButton, Card, Pill, SectionLabel, Spinner, EmptyState } from '../components/primitives';
import { useTheme } from '../theme/ThemeContext';
import { RADIUS, SHADOW, FONT } from '../theme/tokens';
import type { Sketch, Profile } from '../../lib/supabase';

// ── Icons (24×24, stroke=currentColor) ─────────────────────────
const HeartIcon = ({ filled }: { filled?: boolean }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
  </svg>
);
const ForkIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="6" y1="3" x2="6" y2="15" />
    <circle cx="18" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <path d="M18 9a9 9 0 0 1-9 9" />
  </svg>
);
const EditIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
);
const CodeIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="16 18 22 12 16 6" />
    <polyline points="8 6 2 12 8 18" />
  </svg>
);
const LinkIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
);
const PlayIcon = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <polygon points="5 3 19 12 5 21 5 3" />
  </svg>
);
const StopIcon = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <rect x="4" y="4" width="16" height="16" rx="2" />
  </svg>
);
const CopyIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);
const CheckIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

export function SketchView() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { theme, mode, setMode, resolvedMode } = useTheme();

  const [sketch, setSketch] = useState<Sketch | null>(null);
  const [author, setAuthor] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [bgColor, setBgColor] = useState<string | null>(null);
  const [samplesReady, setSamplesReady] = useState(false);
  const [showShareToast, setShowShareToast] = useState(false);
  const [showEmbedPopover, setShowEmbedPopover] = useState(false);
  const [embedCopied, setEmbedCopied] = useState(false);
  const [scriptCopied, setScriptCopied] = useState(false);
  const [editPrompt, setEditPrompt] = useState('');
  const [forking, setForking] = useState(false);
  const [editedScript, setEditedScript] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const {
    uiState,
    tracksRef,
    engine: engineRef,
    loadScript,
    play,
    stop,
    setListenerPosition,
    setListenerOrientation,
  } = useSatieEngine();

  const faceTracking = useFaceTracking(setListenerOrientation);

  const samplesLoaded = useRef(false);
  const embedPopoverRef = useRef<HTMLDivElement>(null);

  // Close embed popover on outside click + Escape
  useEffect(() => {
    if (!showEmbedPopover) return;
    const onClick = (e: MouseEvent) => {
      if (embedPopoverRef.current && !embedPopoverRef.current.contains(e.target as Node)) {
        setShowEmbedPopover(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowEmbedPopover(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [showEmbedPopover]);

  useEffect(() => {
    if (!id) return;
    samplesLoaded.current = false;
    setSamplesReady(false);
    getPublicSketch(id)
      .then(async (s) => {
        if (s) {
          setSketch(s);
          setLikeCount(s.like_count ?? 0);
          document.title = `${s.title} — Satie`;
          const bgMatch = s.script.match(/^- @bg (#[0-9a-fA-F]{6})/m) ?? s.script.match(/^# @bg (#[0-9a-fA-F]{6})/m);
          if (bgMatch) setBgColor(bgMatch[1]);
          getProfile(s.user_id).then(setAuthor).catch(() => {});
          if (user) {
            hasUserLiked(user.id, s.id).then(setLiked).catch(() => {});
          }
          if (!samplesLoaded.current && engineRef.current) {
            samplesLoaded.current = true;
            loadSketchSamples(s.id, (name, data) =>
              engineRef.current!.loadAudioBuffer(name, data),
            )
              .then(() => setSamplesReady(true))
              .catch(e => {
                console.warn('[SketchView] Failed to load samples:', e);
                setSamplesReady(true);
              });
          } else {
            setSamplesReady(true);
          }
        } else {
          setNotFound(true);
        }
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [id, user, engineRef]);

  const currentScript = editedScript ?? sketch?.script ?? '';
  const isDirty = editedScript !== null && sketch !== null && editedScript !== sketch.script;
  const isOwner = user?.id === sketch?.user_id;

  const handlePlay = useCallback(() => {
    if (!sketch) return;
    if (uiState.isPlaying) {
      stop();
    } else {
      loadScript(currentScript);
      play();
    }
  }, [sketch, uiState.isPlaying, loadScript, play, stop, currentScript]);

  // Hot-reload while playing
  useEffect(() => {
    if (uiState.isPlaying) {
      loadScript(currentScript);
    }
  }, [currentScript, uiState.isPlaying, loadScript]);

  const handleSave = useCallback(async () => {
    if (!sketch || !user || !editedScript) return;
    setSaveError(null);
    setSaving(true);
    try {
      if (isOwner) {
        const updated = await updateSketch(sketch.id, { script: editedScript });
        setSketch(updated);
        setEditedScript(null);
      } else {
        const forked = await forkSketch(user.id, { ...sketch, script: editedScript });
        navigate(`/editor/${forked.id}`);
      }
    } catch (e: any) {
      setSaveError(e?.message ?? 'Failed to save');
    } finally {
      setSaving(false);
    }
  }, [sketch, user, editedScript, isOwner, navigate]);

  const handleDiscardEdits = useCallback(() => {
    setEditedScript(null);
    setSaveError(null);
  }, []);

  const handleLike = useCallback(async () => {
    if (!user || !sketch) return;
    try {
      if (liked) {
        await unlikeSketch(user.id, sketch.id);
        setLiked(false);
        setLikeCount((c) => Math.max(0, c - 1));
      } else {
        await likeSketch(user.id, sketch.id);
        setLiked(true);
        setLikeCount((c) => c + 1);
      }
    } catch (e) {
      console.error('Like failed:', e);
    }
  }, [user, sketch, liked]);

  const handleFork = useCallback(async () => {
    if (!user || !sketch || forking) return;
    setForking(true);
    try {
      const forked = await forkSketch(user.id, sketch);
      navigate(`/editor/${forked.id}`);
    } catch (e) {
      console.error('Failed to fork sketch:', e);
    } finally {
      setForking(false);
    }
  }, [user, sketch, forking, navigate]);

  const handleShare = useCallback(() => {
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(() => {
      setShowShareToast(true);
      setTimeout(() => setShowShareToast(false), 2000);
    }).catch(() => {});
  }, []);

  const handleCopyEmbed = useCallback(() => {
    if (!sketch) return;
    const code = `<iframe src="${window.location.origin}/embed/${sketch.id}" width="600" height="400" frameborder="0"></iframe>`;
    navigator.clipboard.writeText(code).then(() => {
      setEmbedCopied(true);
      setTimeout(() => setEmbedCopied(false), 1600);
    }).catch(() => {});
  }, [sketch]);

  const handleCopyScript = useCallback(() => {
    if (!currentScript) return;
    navigator.clipboard.writeText(currentScript).then(() => {
      setScriptCopied(true);
      setTimeout(() => setScriptCopied(false), 1600);
    }).catch(() => {});
  }, [currentScript]);

  const handleEditSubmit = useCallback(async () => {
    if (!sketch) return;
    if (!user) return;
    if (forking) return;

    if (isOwner) {
      navigate(`/editor/${sketch.id}`);
    } else {
      setForking(true);
      try {
        const forked = await forkSketch(user.id, sketch);
        navigate(`/editor/${forked.id}`);
      } catch (e) {
        console.error('Failed to fork for edit:', e);
      } finally {
        setForking(false);
      }
    }
  }, [sketch, user, isOwner, forking, navigate]);

  // Strip the leading metadata @bg comment from the displayed script — it's
  // implementation detail, not user content.
  const displayScript = currentScript
    .replace(/^- @bg #[0-9a-fA-F]{6}\n?/m, '')
    .replace(/^# @bg #[0-9a-fA-F]{6}\n?/m, '');
  const lineCount = displayScript.split('\n').length;

  if (loading) {
    return (
      <div style={{ ...containerStyle(theme), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spinner size={32} />
      </div>
    );
  }

  if (notFound || !sketch) {
    return (
      <div style={{ ...containerStyle(theme), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <EmptyState
          title="Sketch not found"
          description="It may be private or have been deleted."
          action={
            <Button variant="primary" onClick={() => navigate('/explore')}>
              Browse public sketches
            </Button>
          }
        />
      </div>
    );
  }

  // Sketch bg must NOT track the viewer's page theme — switching light/dark
  // would otherwise repaint the canvas mid-view. Fall back to the Editor's
  // initial default so sketches authored without an explicit @bg look the same
  // here as in the editor.
  const viewportBg = bgColor ?? '#000000';
  const isDark = resolvedMode === 'dark';

  return (
    <div style={containerStyle(theme)}>
      <Header
        theme={theme}
        mode={mode}
        setMode={setMode}
        rightExtra={
          <Button
            variant="inverted"
            size="sm"
            rounded="pill"
            iconLeft={<LinkIcon />}
            onClick={handleShare}
            aria-label="Copy sketch link"
          >
            Share
          </Button>
        }
      />

      {/* Share toast */}
      {showShareToast && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed',
            top: 20,
            left: '50%',
            transform: 'translateX(-50%)',
            background: theme.invertedBg,
            color: theme.invertedText,
            padding: '8px 20px',
            borderRadius: RADIUS.md,
            fontSize: FONT.size.body,
            fontWeight: 500,
            zIndex: 9999,
            fontFamily: "'Inter', system-ui, sans-serif",
            boxShadow: SHADOW.lg,
          }}
        >
          Link copied to clipboard
        </div>
      )}

      {/* Main */}
      <div style={{
        maxWidth: 960,
        margin: '0 auto',
        padding: '8px 32px 60px',
        boxSizing: 'border-box',
      }}>
        {/* HERO — title + meta ABOVE the viewport so it's never below the fold */}
        <section style={{ marginBottom: 20 }}>
          <h1 style={{
            fontSize: 'clamp(28px, 4vw, 36px)',
            fontWeight: FONT.weight.semibold,
            margin: '0 0 10px',
            letterSpacing: '-0.015em',
            lineHeight: 1.15,
            color: theme.text,
          }}>
            {sketch.title}
          </h1>
          <div style={{
            fontSize: FONT.size.body,
            color: theme.text,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
          }}>
            {author && (
              <Link
                to={`/u/${author.username}`}
                style={{
                  color: theme.text,
                  textDecoration: 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  opacity: 0.85,
                }}
              >
                <span style={{
                  width: 20,
                  height: 20,
                  borderRadius: 10,
                  background: avatarGradient(author.username),
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                  fontSize: 11,
                  fontWeight: 600,
                  textShadow: '0 0 4px rgba(0,0,0,0.3)',
                }}>
                  {author.username[0]?.toUpperCase()}
                </span>
                @{author.username}
              </Link>
            )}
            {author && <span style={{ opacity: 0.3 }}>·</span>}
            <span style={{ opacity: 0.55 }}>
              {new Date(sketch.updated_at).toLocaleDateString('en-US', {
                month: 'long', day: 'numeric', year: 'numeric',
              })}
            </span>
            {sketch.forked_from && (
              <>
                <span style={{ opacity: 0.3 }}>·</span>
                <span style={{ opacity: 0.55, fontStyle: 'italic' }}>
                  forked from <Link to={`/s/${sketch.forked_from}`} style={{ color: theme.text }}>another sketch</Link>
                </span>
              </>
            )}
          </div>
        </section>

        {/* Viewport with overlay controls */}
        <div style={{
          position: 'relative',
          width: '100%',
          aspectRatio: '16/9',
          borderRadius: RADIUS.xl,
          overflow: 'hidden',
          border: `1px solid ${theme.cardBorder}`,
          background: viewportBg,
          marginBottom: 16,
          boxShadow: SHADOW.md,
        }}>
          <div style={{ width: '100%', height: '100%' }}>
            <SpatialViewport
              tracksRef={tracksRef}
              bgColor={viewportBg}
              onListenerMove={setListenerPosition}
              onListenerRotate={setListenerOrientation}
              faceTracking={{ enabled: faceTracking.enabled, meshRef: faceTracking.meshRef }}
            />
          </div>

          {/* Big centered play button when not playing */}
          {!uiState.isPlaying && samplesReady && (
            <button
              onClick={handlePlay}
              aria-label="Play sketch"
              style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                width: 64,
                height: 64,
                borderRadius: 32,
                background: theme.overlayBg,
                backdropFilter: 'blur(8px)',
                border: `1.5px solid ${theme.overlayBorder}`,
                color: theme.overlayText,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'transform 0.12s, background 0.15s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.transform = 'translate(-50%, -50%) scale(1.05)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = 'translate(-50%, -50%)'; }}
            >
              <PlayIcon size={28} />
            </button>
          )}

          {/* Top-right overlay controls — moved out of the way so the
              ControlsHint pill can sit cleanly along the bottom edge. */}
          <div style={{
            position: 'absolute',
            top: 12,
            right: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
            justifyContent: 'flex-end',
          }}>
            <Pill
              variant="overlay"
              size="sm"
              iconLeft={uiState.isPlaying ? <StopIcon /> : <PlayIcon />}
              onClick={handlePlay}
              aria-label={uiState.isPlaying ? 'Stop playback' : 'Play sketch'}
            >
              {uiState.isPlaying ? 'Stop' : 'Play'}
            </Pill>

            <Pill
              variant="overlay"
              size="sm"
              onClick={faceTracking.toggle}
              disabled={faceTracking.loading}
              title={faceTracking.enabled ? 'Disable camera head tracking' : 'Enable camera head tracking'}
              aria-label={faceTracking.enabled ? 'Disable head tracking' : 'Enable head tracking'}
              aria-pressed={faceTracking.enabled}
              iconLeft={
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="10" r="3" />
                  <path d="M2 8l3-3h4l2-2 2 2h4l3 3v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V8z" />
                </svg>
              }
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                {faceTracking.loading ? 'Loading…' : faceTracking.error ? 'Camera blocked' : 'Camera'}
                <span style={{
                  width: 28,
                  height: 16,
                  borderRadius: 8,
                  background: faceTracking.enabled ? theme.overlayText : 'rgba(255,255,255,0.25)',
                  position: 'relative',
                  transition: 'background 0.2s',
                  display: 'inline-block',
                }}>
                  <span style={{
                    width: 12,
                    height: 12,
                    borderRadius: 6,
                    background: faceTracking.enabled ? theme.overlayBg : theme.overlayText,
                    position: 'absolute',
                    top: 2,
                    left: faceTracking.enabled ? 14 : 2,
                    transition: 'left 0.2s, background 0.2s',
                    display: 'block',
                  }} />
                </span>
              </span>
            </Pill>
          </div>

          {/* Unified controls hint — appears once tracks are loaded */}
          {uiState.trackCount > 0 && (
            <ControlsHint position={{ bottom: 12, left: '50%', transform: 'translateX(-50%)' }} />
          )}
        </div>

        {/* ACTION CLUSTER — first-class, replaces the kebab menu */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          flexWrap: 'wrap',
          marginBottom: 28,
        }}>
          <Button
            variant="ghost"
            size="sm"
            iconLeft={<HeartIcon filled={liked} />}
            onClick={handleLike}
            disabled={!user}
            title={user ? (liked ? 'Unlike' : 'Like') : 'Sign in to like'}
            aria-label={liked ? 'Unlike sketch' : 'Like sketch'}
            aria-pressed={liked}
            style={{ color: liked ? theme.danger : theme.text }}
          >
            {likeCount > 0 ? `${likeCount}` : 'Like'}
          </Button>

          <Button
            variant="ghost"
            size="sm"
            iconLeft={<ForkIcon />}
            onClick={handleFork}
            disabled={!user || forking || isOwner}
            title={isOwner ? 'You own this sketch' : (user ? 'Fork to your account' : 'Sign in to fork')}
            aria-label="Fork sketch"
          >
            {forking ? 'Forking…' : (sketch.fork_count ?? 0) > 0 ? `${sketch.fork_count}` : 'Fork'}
          </Button>

          {isOwner && (
            <Button
              variant="ghost"
              size="sm"
              iconLeft={<EditIcon />}
              onClick={() => navigate(`/editor/${sketch.id}`)}
              aria-label="Open in editor"
            >
              Edit
            </Button>
          )}

          <div style={{ position: 'relative' }} ref={embedPopoverRef}>
            <Button
              variant="ghost"
              size="sm"
              iconLeft={<CodeIcon />}
              onClick={() => setShowEmbedPopover(v => !v)}
              aria-label="Show embed code"
              aria-expanded={showEmbedPopover}
              aria-haspopup="dialog"
            >
              Embed
            </Button>
            {showEmbedPopover && (
              <Card
                role="dialog"
                aria-modal="true"
                aria-label="Embed code"
                padding={14}
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 6px)',
                  left: 0,
                  width: 360,
                  zIndex: 50,
                  boxShadow: SHADOW.lg,
                }}
              >
                <div style={{
                  fontSize: FONT.size.xs,
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  fontWeight: 500,
                  opacity: 0.5,
                  marginBottom: 8,
                  color: theme.text,
                }}>
                  Embed code
                </div>
                <code style={{
                  display: 'block',
                  background: theme.cardBgSubtle,
                  border: `1px solid ${theme.cardBorder}`,
                  borderRadius: RADIUS.md,
                  padding: '8px 10px',
                  fontSize: FONT.size.sm,
                  fontFamily: "'SF Mono', 'Consolas', monospace",
                  color: theme.text,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                  lineHeight: 1.5,
                }}>
                  {`<iframe src="${window.location.origin}/embed/${sketch.id}" width="600" height="400" frameborder="0"></iframe>`}
                </code>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
                  <Button
                    variant="primary"
                    size="sm"
                    iconLeft={embedCopied ? <CheckIcon /> : <CopyIcon />}
                    onClick={handleCopyEmbed}
                  >
                    {embedCopied ? 'Copied' : 'Copy'}
                  </Button>
                </div>
              </Card>
            )}
          </div>

          <Button
            variant="ghost"
            size="sm"
            iconLeft={<LinkIcon />}
            onClick={handleShare}
            aria-label="Copy share link"
          >
            Share
          </Button>
        </div>

        {/* Script section — terminal-style */}
        <section>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 10,
            gap: 8,
            flexWrap: 'wrap',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <SectionLabel>script.satie</SectionLabel>
              <span style={{
                fontSize: FONT.size.xs,
                opacity: 0.4,
                fontFamily: "'SF Mono', 'Consolas', monospace",
                color: theme.text,
              }}>
                {lineCount} {lineCount === 1 ? 'line' : 'lines'}
              </span>
            </div>
            {isDirty ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Pill
                  size="sm"
                  variant="outline"
                  style={{
                    background: 'rgba(139,105,20,0.10)',
                    borderColor: theme.warn,
                    color: theme.warn,
                  }}
                >
                  unsaved edits
                </Pill>
                <Button variant="ghost" size="sm" onClick={handleDiscardEdits} disabled={saving}>
                  Discard
                </Button>
                {user ? (
                  <Button variant="primary" size="sm" onClick={handleSave} disabled={saving}>
                    {saving ? 'Saving…' : isOwner ? 'Save' : 'Fork & save'}
                  </Button>
                ) : (
                  <span style={{ fontSize: FONT.size.body, opacity: 0.5, color: theme.text }}>Sign in to save</span>
                )}
              </div>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                iconLeft={scriptCopied ? <CheckIcon /> : <CopyIcon />}
                onClick={handleCopyScript}
                aria-label="Copy script"
              >
                {scriptCopied ? 'Copied' : 'Copy'}
              </Button>
            )}
          </div>

          <div style={{
            background: isDark ? theme.monaco.background : theme.invertedBg,
            border: `1px solid ${theme.cardBorder}`,
            borderRadius: RADIUS.lg,
            overflow: 'hidden',
            height: 420,
            boxShadow: SHADOW.sm,
          }}>
            <SatieEditor
              value={currentScript}
              onChange={setEditedScript}
              onRun={handlePlay}
              errors={null}
            />
          </div>
          {saveError && (
            <div role="alert" style={{ color: theme.danger, fontSize: FONT.size.body, marginTop: 8 }}>
              {saveError}
            </div>
          )}

          {/* Inline edit prompt */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginTop: 14,
          }}>
            {user ? (
              <>
                <input
                  type="text"
                  placeholder={isOwner ? 'Open in editor for full edit…' : 'Or prompt an edit — opens the full editor'}
                  value={editPrompt}
                  onChange={(e) => setEditPrompt(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleEditSubmit(); }}
                  aria-label="Prompt an edit"
                  style={{
                    flex: 1,
                    padding: '10px 14px',
                    background: theme.cardBg,
                    border: `1px solid ${theme.cardBorder}`,
                    borderRadius: RADIUS.lg,
                    fontSize: FONT.size.md,
                    fontFamily: "'Inter', system-ui, sans-serif",
                    color: theme.text,
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
                <IconButton
                  variant="solid"
                  size={40}
                  onClick={handleEditSubmit}
                  disabled={forking}
                  aria-label="Submit edit prompt"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="19" x2="12" y2="5" />
                    <polyline points="5 12 12 5 19 12" />
                  </svg>
                </IconButton>
              </>
            ) : (
              <div style={{
                flex: 1,
                padding: '10px 14px',
                background: theme.cardBg,
                border: `1px solid ${theme.cardBorder}`,
                borderRadius: RADIUS.lg,
                fontSize: FONT.size.md,
                color: theme.text,
                opacity: 0.55,
                fontFamily: "'Inter', system-ui, sans-serif",
              }}>
                Sign in to edit or fork this sketch
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function containerStyle(theme: ReturnType<typeof useTheme>['theme']): React.CSSProperties {
  return {
    width: '100%',
    height: '100vh',
    overflowY: 'auto',
    overflowX: 'hidden',
    background: theme.bg,
    fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
    color: theme.text,
  };
}

/** Deterministic gradient avatar from a username. */
function avatarGradient(username: string): string {
  let h = 0;
  for (let i = 0; i < username.length; i++) h = (h * 31 + username.charCodeAt(i)) >>> 0;
  const a = h % 360;
  const b = (a + 60) % 360;
  return `linear-gradient(135deg, hsl(${a},65%,55%), hsl(${b},65%,45%))`;
}
