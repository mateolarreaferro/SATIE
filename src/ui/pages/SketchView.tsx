import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/AuthContext';
import { getPublicSketch, forkSketch } from '../../lib/sketches';
import { likeSketch, unlikeSketch, hasUserLiked } from '../../lib/likes';
import { getProfile } from '../../lib/profiles';
import { loadSketchSamples } from '../../lib/sampleStorage';
import { useSatieEngine } from '../hooks/useSatieEngine';
import { useFaceTracking } from '../hooks/useFaceTracking';
import { SpatialViewport } from '../components/SpatialViewport';
import { SatieScriptViewer } from '../components/SatieScriptViewer';
import type { Sketch, Profile } from '../../lib/supabase';

export function SketchView() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [sketch, setSketch] = useState<Sketch | null>(null);
  const [author, setAuthor] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [bgColor, setBgColor] = useState('#f4f3ee');
  const [samplesReady, setSamplesReady] = useState(false);
  const [showShareToast, setShowShareToast] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [editPrompt, setEditPrompt] = useState('');
  const [forking, setForking] = useState(false);

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
  const moreMenuRef = useRef<HTMLDivElement>(null);

  // Close more menu on outside click
  useEffect(() => {
    if (!showMoreMenu) return;
    const handler = (e: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setShowMoreMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMoreMenu]);

  useEffect(() => {
    if (!id) return;
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
          // Load samples for this sketch so audio can play
          if (!samplesLoaded.current && engineRef.current) {
            samplesLoaded.current = true;
            loadSketchSamples(s.id, (name, data) =>
              engineRef.current!.loadAudioBuffer(name, data),
            )
              .then(() => setSamplesReady(true))
              .catch(e => {
                console.warn('[SketchView] Failed to load samples:', e);
                setSamplesReady(true); // allow play attempt anyway
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

  const handlePlay = useCallback(() => {
    if (!sketch) return;
    if (uiState.isPlaying) {
      stop();
    } else {
      loadScript(sketch.script);
      play();
    }
  }, [sketch, uiState.isPlaying, loadScript, play, stop]);

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
    if (!user || !sketch) return;
    try {
      setForking(true);
      const forked = await forkSketch(user.id, sketch);
      navigate(`/editor/${forked.id}`);
    } catch (e) {
      console.error('Failed to fork sketch:', e);
      setForking(false);
    }
  }, [user, sketch, navigate]);

  const handleShare = useCallback(() => {
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(() => {
      setShowShareToast(true);
      setTimeout(() => setShowShareToast(false), 2000);
    }).catch(() => {});
  }, []);

  const handleEditSubmit = useCallback(async () => {
    if (!editPrompt.trim() || !sketch) return;
    if (!user) return; // must be signed in

    const isOwner = user.id === sketch.user_id;
    if (isOwner) {
      // Owner goes directly to editor
      navigate(`/editor/${sketch.id}`);
    } else {
      // Non-owner: fork first, then open in editor
      try {
        setForking(true);
        const forked = await forkSketch(user.id, sketch);
        navigate(`/editor/${forked.id}`);
      } catch (e) {
        console.error('Failed to fork for edit:', e);
        setForking(false);
      }
    }
  }, [editPrompt, sketch, user, navigate]);

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.center}>loading...</div>
      </div>
    );
  }

  if (notFound || !sketch) {
    return (
      <div style={styles.container}>
        <div style={styles.center}>
          <div style={{ fontSize: '16px', fontWeight: 600, marginBottom: '8px' }}>
            Sketch not found
          </div>
          <p style={{ fontSize: '15px', opacity: 0.4, marginBottom: '20px' }}>
            This sketch may be private or may have been deleted.
          </p>
          <Link to="/explore" style={styles.linkBtn}>Browse public sketches</Link>
        </div>
      </div>
    );
  }

  const isOwner = user?.id === sketch.user_id;

  return (
    <div style={styles.container}>
      {/* Header */}
      <header style={styles.header}>
        <Link to="/" style={{ textDecoration: 'none', color: '#0a0a0a', fontSize: '22px', fontWeight: 700, letterSpacing: '0.06em' }}>
          satie
        </Link>

        <button onClick={handleShare} style={styles.shareBtn}>
          Share
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
        </button>
      </header>

      {/* Share toast */}
      {showShareToast && (
        <div style={styles.toast}>Link copied to clipboard</div>
      )}

      {/* Main content */}
      <div style={styles.main}>
        {/* Viewport with overlay controls */}
        <div style={styles.viewportWrapper}>
          <div style={styles.viewport}>
            <SpatialViewport
              tracksRef={tracksRef}
              bgColor={bgColor}
              onListenerMove={setListenerPosition}
              onListenerRotate={setListenerOrientation}
              faceTracking={{ enabled: faceTracking.enabled, meshRef: faceTracking.meshRef }}
            />
          </div>

          {/* Big centered play button when not playing */}
          {!uiState.isPlaying && (
            <button onClick={handlePlay} style={styles.bigPlayBtn} aria-label="Play">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="#faf9f6" stroke="none">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            </button>
          )}

          {/* Bottom overlay controls */}
          <div style={styles.viewportControls}>
            <button
              onClick={handlePlay}
              style={styles.controlBtn}
            >
              {uiState.isPlaying ? (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="#faf9f6" stroke="none">
                    <rect x="4" y="4" width="16" height="16" rx="2" />
                  </svg>
                  Stop
                </>
              ) : (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="#faf9f6" stroke="none">
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                  Play
                </>
              )}
            </button>

            <button
              onClick={faceTracking.toggle}
              disabled={faceTracking.loading}
              title={faceTracking.enabled ? 'Disable camera head tracking' : 'Enable camera head tracking (rotate with your head)'}
              style={{
                ...styles.controlBtnOutline,
                background: faceTracking.enabled ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.4)',
                cursor: faceTracking.loading ? 'wait' : 'pointer',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="10" r="3" />
                <path d="M2 8l3-3h4l2-2 2 2h4l3 3v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V8z" />
              </svg>
              {faceTracking.loading ? 'Loading…' : faceTracking.error ? 'Camera blocked' : 'Camera'}
              <div style={{
                width: 32,
                height: 18,
                borderRadius: 9,
                background: faceTracking.enabled ? '#faf9f6' : 'rgba(255,255,255,0.3)',
                position: 'relative',
                transition: 'background 0.2s',
              }}>
                <div style={{
                  width: 14,
                  height: 14,
                  borderRadius: 7,
                  background: faceTracking.enabled ? '#0a0a0a' : '#faf9f6',
                  position: 'absolute',
                  top: 2,
                  left: faceTracking.enabled ? 16 : 2,
                  transition: 'left 0.2s, background 0.2s',
                }} />
              </div>
            </button>

            {/* More menu */}
            <div style={{ position: 'relative' }} ref={moreMenuRef}>
              <button
                onClick={() => setShowMoreMenu(v => !v)}
                style={styles.controlBtnIcon}
                aria-label="More options"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="#faf9f6" stroke="none">
                  <circle cx="12" cy="5" r="2" />
                  <circle cx="12" cy="12" r="2" />
                  <circle cx="12" cy="19" r="2" />
                </svg>
              </button>

              {showMoreMenu && (
                <div style={styles.moreMenu}>
                  {user && (
                    <button onClick={handleLike} style={styles.menuItem}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill={liked ? '#8b0000' : 'none'} stroke={liked ? '#8b0000' : '#0a0a0a'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                      </svg>
                      {liked ? 'Unlike' : 'Like'}{likeCount > 0 ? ` (${likeCount})` : ''}
                    </button>
                  )}
                  {user && !isOwner && (
                    <button onClick={handleFork} disabled={forking} style={styles.menuItem}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0a0a0a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="6" y1="3" x2="6" y2="15" />
                        <circle cx="18" cy="6" r="3" />
                        <circle cx="6" cy="18" r="3" />
                        <path d="M18 9a9 9 0 0 1-9 9" />
                      </svg>
                      {forking ? 'Forking...' : 'Fork'}{(sketch.fork_count ?? 0) > 0 ? ` (${sketch.fork_count})` : ''}
                    </button>
                  )}
                  {isOwner && (
                    <button onClick={() => navigate(`/editor/${sketch.id}`)} style={styles.menuItem}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#0a0a0a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                      Edit in editor
                    </button>
                  )}
                  <button
                    onClick={() => {
                      const embedCode = `<iframe src="${window.location.origin}/embed/${sketch.id}" width="600" height="400" frameborder="0"></iframe>`;
                      navigator.clipboard.writeText(embedCode).catch(() => {});
                      setShowMoreMenu(false);
                    }}
                    style={styles.menuItem}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0a0a0a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="16 18 22 12 16 6" />
                      <polyline points="8 6 2 12 8 18" />
                    </svg>
                    Copy embed code
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Title + meta */}
        <div style={styles.titleSection}>
          <h1 style={styles.title}>{sketch.title}</h1>
          <div style={styles.metaRow}>
            {author ? (
              <Link
                to={`/u/${author.username}`}
                style={{ color: '#0a0a0a', textDecoration: 'none', opacity: 0.5 }}
              >
                @{author.username}
              </Link>
            ) : null}
            {author ? <span style={{ opacity: 0.3 }}> · </span> : ''}
            <span style={{ opacity: 0.35 }}>
              {new Date(sketch.updated_at).toLocaleDateString('en-US', {
                month: 'long', day: 'numeric', year: 'numeric',
              })}
            </span>
            {likeCount > 0 && (
              <>
                <span style={{ opacity: 0.3 }}> · </span>
                <span style={{ opacity: 0.35, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#0a0a0a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                  </svg>
                  {likeCount}
                </span>
              </>
            )}
            {(sketch.fork_count ?? 0) > 0 && (
              <>
                <span style={{ opacity: 0.3 }}> · </span>
                <span style={{ opacity: 0.35, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#0a0a0a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="6" y1="3" x2="6" y2="15" />
                    <circle cx="18" cy="6" r="3" />
                    <circle cx="6" cy="18" r="3" />
                    <path d="M18 9a9 9 0 0 1-9 9" />
                  </svg>
                  {sketch.fork_count}
                </span>
              </>
            )}
          </div>
          {sketch.forked_from && (
            <div style={{ fontSize: '14px', opacity: 0.25, fontStyle: 'italic', marginTop: 2 }}>
              forked from <Link to={`/s/${sketch.forked_from}`} style={{ color: '#0a0a0a' }}>another sketch</Link>
            </div>
          )}
        </div>

        {/* Script section */}
        <div style={styles.scriptSection}>
          <div style={styles.sectionLabel}>Satie Script</div>
          <div style={{ position: 'relative' }}>
            <SatieScriptViewer script={sketch.script} style={styles.script} />

            {/* Prompt an edit — floating input at bottom of script */}
            {user && (
              <div style={styles.editInputWrapper}>
                <input
                  type="text"
                  placeholder="Prompt an edit"
                  value={editPrompt}
                  onChange={(e) => setEditPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleEditSubmit();
                  }}
                  style={styles.editInput}
                />
                <button
                  onClick={handleEditSubmit}
                  disabled={!editPrompt.trim() || forking}
                  style={{
                    ...styles.editSubmitBtn,
                    opacity: editPrompt.trim() ? 1 : 0.3,
                  }}
                  aria-label="Submit edit"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0a0a0a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="19" x2="12" y2="5" />
                    <polyline points="5 12 12 5 19 12" />
                  </svg>
                </button>
              </div>
            )}
            {!user && (
              <div style={styles.editInputWrapper}>
                <div style={{
                  ...styles.editInput,
                  opacity: 0.5,
                  cursor: 'default',
                  display: 'flex',
                  alignItems: 'center',
                }}>
                  Sign in to edit or fork this sketch
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: '100%',
    height: '100vh',
    overflowY: 'auto',
    overflowX: 'hidden',
    background: '#f4f3ee',
    fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
    color: '#0a0a0a',
  },
  center: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    textAlign: 'center',
    fontSize: '16px',
    opacity: 0.4,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 32px',
  },
  shareBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 16px',
    background: '#0a0a0a',
    border: 'none',
    borderRadius: 20,
    cursor: 'pointer',
    fontSize: '14px',
    fontFamily: "'Inter', system-ui, sans-serif",
    color: '#faf9f6',
    fontWeight: 600,
    letterSpacing: '0.02em',
  },
  toast: {
    position: 'fixed' as const,
    top: 20,
    left: '50%',
    transform: 'translateX(-50%)',
    background: '#0a0a0a',
    color: '#faf9f6',
    padding: '8px 20px',
    borderRadius: 8,
    fontSize: '13px',
    fontWeight: 500,
    zIndex: 9999,
    fontFamily: "'Inter', system-ui, sans-serif",
  },
  linkBtn: {
    fontSize: '16px',
    color: '#0a0a0a',
    textDecoration: 'underline',
    opacity: 0.5,
  },
  main: {
    maxWidth: 960,
    margin: '0 auto',
    padding: '8px 32px 60px',
  },
  viewportWrapper: {
    position: 'relative' as const,
    width: '100%',
    aspectRatio: '16/9',
    borderRadius: 16,
    overflow: 'hidden',
    border: '1.5px solid #d0cdc4',
    background: '#0a0a0a',
    marginBottom: '20px',
  },
  viewport: {
    width: '100%',
    height: '100%',
  },
  bigPlayBtn: {
    position: 'absolute' as const,
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: 64,
    height: 64,
    borderRadius: 32,
    background: 'rgba(0,0,0,0.5)',
    backdropFilter: 'blur(8px)',
    border: '1.5px solid rgba(255,255,255,0.15)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'background 0.15s',
  },
  viewportControls: {
    position: 'absolute' as const,
    bottom: 12,
    left: 12,
    right: 12,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  controlBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 16px',
    background: 'rgba(0,0,0,0.55)',
    backdropFilter: 'blur(8px)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: '13px',
    fontFamily: "'Inter', system-ui, sans-serif",
    color: '#faf9f6',
    fontWeight: 600,
  },
  controlBtnOutline: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 12px',
    backdropFilter: 'blur(8px)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: '13px',
    fontFamily: "'Inter', system-ui, sans-serif",
    color: '#faf9f6',
    fontWeight: 500,
  },
  controlBtnIcon: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 32,
    height: 32,
    background: 'rgba(0,0,0,0.55)',
    backdropFilter: 'blur(8px)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 8,
    cursor: 'pointer',
    marginLeft: 'auto',
  },
  moreMenu: {
    position: 'absolute' as const,
    bottom: 40,
    right: 0,
    background: '#faf9f6',
    border: '1px solid #e0ddd4',
    borderRadius: 10,
    padding: '4px 0',
    minWidth: 180,
    boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
    zIndex: 10,
  },
  menuItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    padding: '8px 14px',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '14px',
    fontFamily: "'Inter', system-ui, sans-serif",
    color: '#0a0a0a',
    textAlign: 'left' as const,
  },
  titleSection: {
    marginBottom: '20px',
  },
  title: {
    fontSize: '24px',
    fontWeight: 700,
    margin: '0 0 4px',
    letterSpacing: '-0.01em',
  },
  metaRow: {
    fontSize: '14px',
    color: '#0a0a0a',
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    flexWrap: 'wrap' as const,
  },
  scriptSection: {
    marginBottom: '32px',
  },
  sectionLabel: {
    fontSize: '13px',
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
    opacity: 0.25,
    marginBottom: '10px',
  },
  script: {
    fontSize: '14px',
    fontFamily: "'SF Mono', 'Consolas', monospace",
    background: '#faf9f6',
    border: '1px solid #e0ddd4',
    borderRadius: 12,
    padding: '16px 16px 64px',
    overflow: 'auto',
    maxHeight: 500,
    whiteSpace: 'pre-wrap' as const,
    margin: 0,
    color: '#1a1a1a',
    lineHeight: 1.6,
  },
  editInputWrapper: {
    position: 'absolute' as const,
    bottom: 12,
    left: 12,
    right: 12,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  editInput: {
    flex: 1,
    padding: '10px 14px',
    background: 'rgba(244,243,238,0.85)',
    backdropFilter: 'blur(12px)',
    border: '1px solid #e0ddd4',
    borderRadius: 10,
    fontSize: '14px',
    fontFamily: "'Inter', system-ui, sans-serif",
    color: '#0a0a0a',
    outline: 'none',
    boxSizing: 'border-box' as const,
  },
  editSubmitBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    background: '#e0ddd4',
    border: 'none',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
};
