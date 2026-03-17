import { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/AuthContext';
import { getPublicSketch, forkSketch } from '../../lib/sketches';
import { likeSketch, unlikeSketch, hasUserLiked } from '../../lib/likes';
import { getProfileByUsername, getProfile } from '../../lib/profiles';
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
    loadScript,
    play,
    stop,
    setListenerPosition,
    setListenerOrientation,
  } = useSatieEngine();

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
        } else {
          setNotFound(true);
        }
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [id, user]);

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
        {/* Viewport */}
        <div style={styles.viewport}>
          <SpatialViewport
            tracksRef={tracksRef}
            bgColor="#f4f3ee"
            onListenerMove={setListenerPosition}
            onListenerRotate={setListenerOrientation}
          />
        </div>

        {/* Info + Script */}
        <div style={styles.info}>
          <h1 style={{ fontSize: '18px', fontWeight: 600, margin: '0 0 4px' }}>
            {sketch.title}
          </h1>
          <div style={{ fontSize: '11px', opacity: 0.3, marginBottom: '4px' }}>
            {author ? (
              <Link
                to={`/u/${author.username}`}
                style={{ color: '#0a0a0a', textDecoration: 'none', opacity: 0.6 }}
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
            <div style={{ fontSize: '10px', opacity: 0.25, marginBottom: '4px', fontStyle: 'italic' }}>
              forked from <Link to={`/s/${sketch.forked_from}`} style={{ color: '#0a0a0a' }}>another sketch</Link>
            </div>
          )}
          <div style={{ height: '12px' }} />

          <div style={{
            fontSize: '10px',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            opacity: 0.3,
            marginBottom: '8px',
          }}>
            Script
          </div>
          <pre style={styles.script}>
            {sketch.script}
          </pre>

          {/* Embed code */}
          <div style={{
            fontSize: '10px',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            opacity: 0.3,
            marginTop: '20px',
            marginBottom: '8px',
          }}>
            Embed
          </div>
          <input
            readOnly
            value={`<iframe src="${window.location.origin}/embed/${sketch.id}" width="600" height="400" frameborder="0"></iframe>`}
            onClick={(e) => (e.target as HTMLInputElement).select()}
            style={styles.embedInput}
          />
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
    maxWidth: 1100,
    margin: '0 auto',
    padding: '32px',
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '32px',
  },
  viewport: {
    aspectRatio: '4/3',
    borderRadius: 16,
    overflow: 'hidden',
    border: '1.5px solid #d0cdc4',
    background: '#f4f3ee',
  },
  info: {
    overflow: 'hidden',
  },
  script: {
    fontSize: '11px',
    fontFamily: "'SF Mono', 'Consolas', monospace",
    background: '#faf9f6',
    border: '1px solid #d0cdc4',
    borderRadius: 10,
    padding: '16px',
    overflow: 'auto',
    maxHeight: 360,
    whiteSpace: 'pre-wrap',
    margin: 0,
    color: '#0a0a0a',
  },
  embedInput: {
    width: '100%',
    padding: '8px 10px',
    border: '1px solid #d0cdc4',
    borderRadius: 6,
    fontSize: '10px',
    fontFamily: "'SF Mono', monospace",
    background: '#faf9f6',
    color: '#0a0a0a',
    outline: 'none',
    boxSizing: 'border-box',
  },
};
