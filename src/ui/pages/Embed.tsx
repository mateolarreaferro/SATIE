import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { getPublicSketch } from '../../lib/sketches';
import { useSatieEngine } from '../hooks/useSatieEngine';
import { SpatialViewport } from '../components/SpatialViewport';
import type { Sketch } from '../../lib/supabase';

export function Embed() {
  const { id } = useParams<{ id: string }>();
  const [sketch, setSketch] = useState<Sketch | null>(null);
  const [loading, setLoading] = useState(true);
  const [started, setStarted] = useState(false);

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
      .then(setSketch)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  const handlePlay = useCallback(() => {
    if (!sketch) return;
    if (uiState.isPlaying) {
      stop();
    } else {
      loadScript(sketch.script);
      play();
      setStarted(true);
    }
  }, [sketch, uiState.isPlaying, loadScript, play, stop]);

  if (loading) {
    return <div style={styles.container}><div style={styles.loadingText}>loading...</div></div>;
  }

  if (!sketch) {
    return <div style={styles.container}><div style={styles.loadingText}>not found</div></div>;
  }

  return (
    <div style={styles.container}>
      {/* Viewport fills the embed */}
      <SpatialViewport
        tracksRef={tracksRef}
        bgColor="#f4f3ee"
        onListenerMove={setListenerPosition}
        onListenerRotate={setListenerOrientation}
      />

      {/* Play button overlay */}
      {!started && (
        <div style={styles.overlay} onClick={handlePlay}>
          <div style={styles.playCircle}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="#faf9f6">
              <polygon points="8,5 20,12 8,19" />
            </svg>
          </div>
          <div style={styles.title}>{sketch.title}</div>
        </div>
      )}

      {/* Stop button (small, bottom left) */}
      {started && uiState.isPlaying && (
        <button onClick={handlePlay} style={styles.stopBtn}>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="#faf9f6">
            <rect x="1" y="1" width="8" height="8" />
          </svg>
        </button>
      )}

      {/* Watermark */}
      <a
        href={`${window.location.origin}/s/${sketch.id}`}
        target="_blank"
        rel="noopener noreferrer"
        style={styles.watermark}
      >
        satie
      </a>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: '100vw',
    height: '100vh',
    position: 'relative',
    overflow: 'hidden',
    background: '#f4f3ee',
    margin: 0,
    padding: 0,
  },
  loadingText: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    fontSize: '12px',
    fontFamily: "'Inter', system-ui, sans-serif",
    opacity: 0.4,
    color: '#0a0a0a',
  },
  overlay: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    background: 'rgba(244, 243, 238, 0.6)',
    backdropFilter: 'blur(2px)',
    zIndex: 10,
  },
  playCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    background: '#0a0a0a',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: 3,
    marginBottom: 12,
  },
  title: {
    fontSize: '13px',
    fontWeight: 600,
    fontFamily: "'Inter', system-ui, sans-serif",
    color: '#0a0a0a',
    opacity: 0.7,
  },
  stopBtn: {
    position: 'absolute',
    bottom: 12,
    left: 12,
    width: 28,
    height: 28,
    borderRadius: 14,
    background: '#0a0a0a',
    border: 'none',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.6,
    zIndex: 10,
  },
  watermark: {
    position: 'absolute',
    bottom: 8,
    right: 12,
    fontSize: '10px',
    fontWeight: 700,
    fontFamily: "'Inter', system-ui, sans-serif",
    color: '#0a0a0a',
    opacity: 0.15,
    textDecoration: 'none',
    letterSpacing: '0.04em',
    zIndex: 10,
  },
};
