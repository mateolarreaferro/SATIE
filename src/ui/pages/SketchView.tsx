import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/AuthContext';
import { getPublicSketch, forkSketch } from '../../lib/sketches';
import { likeSketch, unlikeSketch, hasUserLiked } from '../../lib/likes';
import { getProfileByUsername, getProfile } from '../../lib/profiles';
import { loadSketchSamples } from '../../lib/sampleStorage';
import { useSatieEngine } from '../hooks/useSatieEngine';
import { SpatialViewport } from '../components/SpatialViewport';
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

  const samplesLoaded = useRef(false);

  useEffect(() => {
    if (!id) return;
    getPublicSketch(id)
      .then(async (s) => {
        if (s) {
          setSketch(s);
          setLikeCount(s.like_count ?? 0);
          document.title = `${s.title} — Satie`;
          // Load author profile
          getProfile(s.user_id).then(setAuthor).catch(() => {});
          // Check if user liked
          if (user) {
            hasUserLiked(user.id, s.id).then(setLiked).catch(() => {});
          }
          // Load samples for this sketch so audio can play
          if (!samplesLoaded.current && engineRef.current) {
            samplesLoaded.current = true;
            loadSketchSamples(s.id, (name, data) =>
              engineRef.current!.loadAudioBuffer(name, data),
            ).catch(e => console.warn('[SketchView] Failed to load samples:', e));
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
      const forked = await forkSketch(user.id, sketch);
      navigate(`/editor/${forked.id}`);
    } catch (e) {
      console.error('Failed to fork sketch:', e);
    }
  }, [user, sketch, navigate]);

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
          <p style={{ fontSize: '13px', opacity: 0.4, marginBottom: '20px' }}>
            This sketch may be private or may have been deleted.
          </p>
          <Link to="/explore" style={styles.linkBtn}>Browse public sketches</Link>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Header */}
      <header style={styles.header}>
        <Link to="/explore" style={{ textDecoration: 'none', color: '#0a0a0a' }}>
          <div style={{ fontSize: '16px', fontWeight: 700, letterSpacing: '0.04em' }}>
            satie
          </div>
        </Link>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {user && (
            <button
              onClick={handleLike}
              style={{
                ...styles.actionBtn,
                color: liked ? '#8b0000' : '#0a0a0a',
                borderColor: liked ? '#8b0000' : '#0a0a0a',
              }}
            >
              {liked ? 'Liked' : 'Like'}{likeCount > 0 ? ` (${likeCount})` : ''}
            </button>
          )}
          {!user && likeCount > 0 && (
            <span style={{ fontSize: '11px', opacity: 0.35 }}>{likeCount} likes</span>
          )}
          {user && (
            <button onClick={handleFork} style={styles.actionBtn}>
              Fork{(sketch.fork_count ?? 0) > 0 ? ` (${sketch.fork_count})` : ''}
            </button>
          )}
          {user && sketch.user_id === user.id && (
            <button onClick={() => navigate(`/editor/${sketch.id}`)} style={styles.actionBtn}>
              Edit
            </button>
          )}
          <button onClick={handlePlay} style={styles.playBtn}>
            {uiState.isPlaying ? 'Stop' : 'Play'}
          </button>
        </div>
      </header>

      {/* Main content */}
      <div style={styles.main}>
        {/* Viewport — full width */}
        <div style={styles.viewport}>
          <SpatialViewport
            tracksRef={tracksRef}
            bgColor="#f4f3ee"
            onListenerMove={setListenerPosition}
            onListenerRotate={setListenerOrientation}
          />
        </div>

        {/* Below viewport: info left, script right */}
        <div style={styles.belowViewport}>
          {/* Left column: title + meta */}
          <div style={styles.meta}>
            <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 6px', letterSpacing: '-0.01em' }}>
              {sketch.title}
            </h1>
            <div style={{ fontSize: '12px', opacity: 0.35, marginBottom: '4px' }}>
              {author ? (
                <Link
                  to={`/u/${author.username}`}
                  style={{ color: '#0a0a0a', textDecoration: 'none', opacity: 0.7 }}
                >
                  @{author.username}
                </Link>
              ) : null}
              {author ? ' · ' : ''}
              {new Date(sketch.updated_at).toLocaleDateString('en-US', {
                month: 'long', day: 'numeric', year: 'numeric',
              })}
            </div>
            {sketch.forked_from && (
              <div style={{ fontSize: '10px', opacity: 0.25, fontStyle: 'italic' }}>
                forked from <Link to={`/s/${sketch.forked_from}`} style={{ color: '#0a0a0a' }}>another sketch</Link>
              </div>
            )}

            {/* Embed code */}
            <div style={{ marginTop: '24px' }}>
              <div style={styles.sectionLabel}>Embed</div>
              <input
                readOnly
                value={`<iframe src="${window.location.origin}/embed/${sketch.id}" width="600" height="400" frameborder="0"></iframe>`}
                onClick={(e) => (e.target as HTMLInputElement).select()}
                style={styles.embedInput}
              />
            </div>
          </div>

          {/* Right column: script */}
          <div style={styles.scriptCol}>
            <div style={styles.sectionLabel}>Script</div>
            <pre style={styles.script}>
              {sketch.script}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: '100vw',
    minHeight: '100vh',
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
    fontSize: '12px',
    opacity: 0.4,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 32px',
    borderBottom: '1px solid #d0cdc4',
  },
  actionBtn: {
    padding: '5px 14px',
    background: 'none',
    border: '1.5px solid #0a0a0a',
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: '11px',
    fontFamily: "'Inter', system-ui, sans-serif",
    color: '#0a0a0a',
    fontWeight: 500,
  },
  playBtn: {
    padding: '5px 18px',
    background: '#0a0a0a',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: '11px',
    fontFamily: "'Inter', system-ui, sans-serif",
    color: '#faf9f6',
    fontWeight: 600,
  },
  linkBtn: {
    fontSize: '12px',
    color: '#0a0a0a',
    textDecoration: 'underline',
    opacity: 0.5,
  },
  main: {
    maxWidth: 1000,
    margin: '0 auto',
    padding: '28px 32px',
  },
  viewport: {
    width: '100%',
    aspectRatio: '21/9',
    borderRadius: 16,
    overflow: 'hidden',
    border: '1.5px solid #d0cdc4',
    background: '#f4f3ee',
    marginBottom: '24px',
  },
  belowViewport: {
    display: 'grid',
    gridTemplateColumns: '1fr 1.2fr',
    gap: '32px',
    alignItems: 'start',
  },
  meta: {
    paddingTop: '2px',
  },
  scriptCol: {
    overflow: 'hidden',
  },
  sectionLabel: {
    fontSize: '9px',
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
    opacity: 0.25,
    marginBottom: '8px',
  },
  script: {
    fontSize: '11px',
    fontFamily: "'SF Mono', 'Consolas', monospace",
    background: '#faf9f6',
    border: '1px solid #e0ddd4',
    borderRadius: 10,
    padding: '16px',
    overflow: 'auto',
    maxHeight: 400,
    whiteSpace: 'pre-wrap' as const,
    margin: 0,
    color: '#1a1a1a',
    lineHeight: 1.5,
  },
  embedInput: {
    width: '100%',
    padding: '8px 10px',
    border: '1px solid #e0ddd4',
    borderRadius: 6,
    fontSize: '10px',
    fontFamily: "'SF Mono', monospace",
    background: '#faf9f6',
    color: '#0a0a0a',
    outline: 'none',
    boxSizing: 'border-box' as const,
  },
};
