import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { getPublicSketch } from '../../lib/sketches';
import { useSatieEngine } from '../hooks/useSatieEngine';
import { SpatialViewport } from '../components/SpatialViewport';
import { useTheme } from '../theme/ThemeContext';
import { Spinner } from '../components/primitives';
import { RADIUS, FONT } from '../theme/tokens';
import type { Sketch } from '../../lib/supabase';

export function Embed() {
  const { id } = useParams<{ id: string }>();
  const { theme } = useTheme();
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

  // Extract @bg metadata from script (preserves author's chosen viewport bg) — fall back to theme bg.
  const bgMatch = sketch?.script.match(/^- @bg (#[0-9a-fA-F]{6})/m) ?? sketch?.script.match(/^# @bg (#[0-9a-fA-F]{6})/m);
  const viewportBg = bgMatch?.[1] ?? theme.bg;

  const containerStyle: React.CSSProperties = {
    width: '100vw',
    height: '100vh',
    position: 'relative',
    overflow: 'hidden',
    background: theme.bg,
    margin: 0,
    padding: 0,
  };

  if (loading) {
    return (
      <div style={{ ...containerStyle, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spinner size={24} />
      </div>
    );
  }

  if (!sketch) {
    return (
      <div style={{ ...containerStyle, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: theme.textMuted, fontSize: FONT.size.md, fontFamily: "'Inter', system-ui, sans-serif" }}>
          not found
        </span>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <SpatialViewport
        tracksRef={tracksRef}
        bgColor={viewportBg}
        onListenerMove={setListenerPosition}
        onListenerRotate={setListenerOrientation}
      />

      {/* Play button overlay */}
      {!started && (
        <button
          onClick={handlePlay}
          aria-label={`Play ${sketch.title}`}
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            background: theme.overlayBg,
            backdropFilter: 'blur(4px)',
            zIndex: 10,
            border: 'none',
            color: theme.overlayText,
            padding: 0,
          }}
        >
          <span style={{
            width: 56,
            height: 56,
            borderRadius: 28,
            background: theme.overlayText,
            color: theme.overlayBg,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            paddingLeft: 3,
            marginBottom: 12,
          }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="8,5 20,12 8,19" />
            </svg>
          </span>
          <span style={{
            fontSize: FONT.size.md,
            fontWeight: FONT.weight.semibold,
            fontFamily: "'Inter', system-ui, sans-serif",
            color: theme.overlayText,
            opacity: 0.85,
          }}>
            {sketch.title}
          </span>
        </button>
      )}

      {/* Stop button */}
      {started && uiState.isPlaying && (
        <button
          onClick={handlePlay}
          aria-label="Stop playback"
          style={{
            position: 'absolute',
            bottom: 12,
            left: 12,
            width: 28,
            height: 28,
            borderRadius: 14,
            background: theme.overlayBg,
            color: theme.overlayText,
            border: `1px solid ${theme.overlayBorder}`,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: 0.85,
            zIndex: 10,
            backdropFilter: 'blur(6px)',
          }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
            <rect x="1" y="1" width="8" height="8" />
          </svg>
        </button>
      )}

      {/* Watermark */}
      <a
        href={`${window.location.origin}/s/${sketch.id}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Made with Satie — open sketch"
        style={{
          position: 'absolute',
          bottom: 8,
          right: 12,
          fontSize: FONT.size.md,
          fontWeight: 700,
          fontFamily: "'Inter', system-ui, sans-serif",
          color: theme.text,
          opacity: 0.25,
          textDecoration: 'none',
          letterSpacing: '0.04em',
          zIndex: 10,
          padding: '4px 8px',
          borderRadius: RADIUS.sm,
        }}
      >
        satie
      </a>
    </div>
  );
}
