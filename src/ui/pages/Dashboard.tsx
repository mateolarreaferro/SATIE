import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/AuthContext';
import { getUserSketches, createSketch, deleteSketch, updateSketch } from '../../lib/sketches';
import { TEMPLATES } from '../../lib/templates';
import type { Sketch } from '../../lib/supabase';
import { Header } from '../components/Header';
import { useSFX } from '../hooks/useSFX';
import { useTheme } from '../theme/ThemeContext';
import type { Theme } from '../theme/tokens';
import { useBackgroundMusic } from '../hooks/useBackgroundMusic';
import { RiverCanvas } from '../components/RiverCanvas';

const CARD_W = 280;

// ── Sketch card (grid-based) ──

function SketchCard({
  sketch,
  onOpen,
  onDelete,
  onRename,
  sfx,
  theme,
}: {
  sketch: Sketch;
  onOpen: () => void;
  onDelete: () => void;
  onRename: (title: string) => void;
  sfx: ReturnType<typeof useSFX>;
  theme: Theme;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(sketch.title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) inputRef.current.focus();
  }, [editing]);

  const commitRename = () => {
    setEditing(false);
    const trimmed = title.trim() || 'Untitled';
    setTitle(trimmed);
    if (trimmed !== sketch.title) onRename(trimmed);
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <div
      className="sketch-card"
      onClick={(e) => {
        const tag = (e.target as HTMLElement).tagName;
        if (tag === 'BUTTON' || tag === 'INPUT') return;
        sfx.open();
        onOpen();
      }}
      onMouseEnter={sfx.hover}
      style={{
        width: CARD_W,
        background: theme.mode === 'dark' ? 'rgba(26,25,24,0.75)' : theme.mode === 'fade' ? 'rgba(255,255,255,0.25)' : 'rgba(250,249,246,0.65)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        border: `1.5px solid ${theme.cardBorder}`,
        borderRadius: 16,
        padding: '16px',
        cursor: 'pointer',
        userSelect: 'none',
        boxShadow: '0 2px 16px rgba(0,0,0,0.04)',
        transition: 'box-shadow 0.2s, background 0.5s, border-color 0.15s, transform 0.15s',
      }}
      onMouseOver={(e) => { e.currentTarget.style.borderColor = theme.text + '40'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
      onMouseOut={(e) => { e.currentTarget.style.borderColor = theme.cardBorder; e.currentTarget.style.transform = 'translateY(0)'; }}
    >
      {/* Title — double click to edit */}
      {editing ? (
        <input
          ref={inputRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') { setTitle(sketch.title); setEditing(false); } }}
          style={{
            fontSize: '15px',
            fontWeight: 600,
            color: theme.text,
            fontFamily: "'Inter', system-ui, sans-serif",
            border: 'none',
            borderBottom: `1.5px solid ${theme.text}`,
            background: 'transparent',
            outline: 'none',
            width: '100%',
            padding: '0 0 2px',
            marginBottom: '8px',
          }}
        />
      ) : (
        <div
          onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }}
          style={{
            fontSize: '15px',
            fontWeight: 600,
            marginBottom: '8px',
            color: theme.text,
          }}
        >
          {title}
        </div>
      )}

      {/* Preview */}
      <pre style={{
        fontSize: '12px',
        fontFamily: "'SF Mono', 'Consolas', monospace",
        opacity: theme.mode === 'fade' ? 0.55 : 0.4,
        whiteSpace: 'pre-wrap',
        overflow: 'hidden',
        maxHeight: 56,
        margin: '0 0 12px',
        color: theme.text,
        lineHeight: 1.4,
      }}>
        {sketch.script.slice(0, 120)}
        {sketch.script.length > 120 ? '...' : ''}
      </pre>

      {/* Meta */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        fontSize: '12px',
        opacity: theme.mode === 'fade' ? 0.5 : 0.35,
        color: theme.text,
      }}>
        <span>{formatDate(sketch.updated_at)}</span>
        {sketch.is_public && (
          <span style={{
            background: theme.text,
            color: theme.invertedText,
            padding: '1px 6px',
            borderRadius: 4,
            fontSize: '10px',
          }}>
            public
          </span>
        )}
        <button
          className="delete-btn"
          onClick={(e) => { e.stopPropagation(); sfx.del(); onDelete(); }}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: '12px',
            color: theme.mode === 'dark' ? '#e8e6e1' : theme.text,
            opacity: theme.mode === 'dark' ? 0.3 : 0.4,
            marginLeft: 'auto',
            fontFamily: "'Inter', system-ui, sans-serif",
          }}
        >
          delete
        </button>
      </div>
    </div>
  );
}

export function Dashboard() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const sfx = useSFX();
  useBackgroundMusic('/Satie-Theme.wav', 0.08);
  const { theme, mode, setMode } = useTheme();
  const [sketches, setSketches] = useState<Sketch[]>([]);
  const [loadingSketches, setLoadingSketches] = useState(false);

  const fetchSketches = useCallback(async () => {
    if (!user) return;
    setLoadingSketches(true);
    try {
      const data = await getUserSketches(user.id);
      setSketches(data);
    } catch (err) {
      console.error('Failed to load sketches:', err);
    } finally {
      setLoadingSketches(false);
    }
  }, [user]);

  useEffect(() => {
    fetchSketches();
  }, [fetchSketches]);

  const handleNew = useCallback(async () => {
    if (!user) {
      navigate('/editor');
      return;
    }
    try {
      const sketch = await createSketch(user.id, 'Untitled', '# satie\n');
      navigate(`/editor/${sketch.id}`);
    } catch (err) {
      console.error('Failed to create sketch:', err);
    }
  }, [user, navigate]);

  const handleNewFromTemplate = useCallback(async (title: string, script: string) => {
    if (!user) {
      // Guest mode: navigate to editor with template in URL state
      navigate('/editor', { state: { templateTitle: title, templateScript: script } });
      return;
    }
    try {
      const sketch = await createSketch(user.id, title, script);
      navigate(`/editor/${sketch.id}`);
    } catch (err) {
      console.error('Failed to create sketch from template:', err);
    }
  }, [user, navigate]);

  const handleDelete = useCallback(async (id: string) => {
    try {
      await deleteSketch(id);
      setSketches(prev => prev.filter(s => s.id !== id));
    } catch (err) {
      console.error('Failed to delete sketch:', err);
    }
  }, []);

  const handleRename = useCallback(async (id: string, title: string) => {
    try {
      await updateSketch(id, { title });
      setSketches(prev => prev.map(s => s.id === id ? { ...s, title } : s));
    } catch (err) {
      console.error('Failed to rename sketch:', err);
    }
  }, []);

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.loadingText}>loading...</div>
      </div>
    );
  }

  return (
    <>

      <div style={{ ...styles.container, background: theme.bg, color: theme.text, transition: 'background 1.5s ease, color 1.5s ease', position: 'relative' }}>
        <RiverCanvas mode={mode} />
        <Header theme={theme} mode={mode} setMode={setMode} />

        {/* Content area */}
        <div style={styles.content}>
          {!user && (
            <div style={styles.welcome}>
              <div style={styles.welcomeTitle}>Welcome to Satie</div>
              <p style={styles.welcomeSubtitle}>
                Sign in to save and revisit your compositions, or start a new sketch as a guest.
              </p>
              <button className="welcome-btn" onClick={() => { sfx.click(); handleNew(); }} onMouseEnter={sfx.hover} style={{ ...styles.welcomeBtn, background: theme.invertedBg, color: theme.invertedText, transition: 'background 0.3s, color 0.3s' }}>
                Open Editor
              </button>
            </div>
          )}

          {user && loadingSketches && (
            <div style={styles.loadingText}>loading sketches...</div>
          )}

          {user && !loadingSketches && sketches.length === 0 && (
            <div style={styles.welcome}>
              <div style={styles.welcomeTitle}>No sketches yet</div>
              <p style={styles.welcomeSubtitle}>Create your first composition, or start from a template.</p>
            </div>
          )}

          {/* Templates — always available so returning users can still scaffold from a template */}
          {(!user || !loadingSketches) && (
            <div style={{
              display: 'flex',
              gap: '10px',
              flexWrap: 'wrap',
              justifyContent: 'center',
              marginBottom: 32,
            }}>
              <div style={{
                width: '100%',
                textAlign: 'center',
                fontSize: '12px',
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
                opacity: 0.3,
                fontWeight: 600,
                marginBottom: 2,
                fontFamily: "'Inter', system-ui, sans-serif",
              }}>Templates</div>
              {TEMPLATES.map((tmpl) => (
                <button
                  key={tmpl.title}
                  className="template-btn"
                  onClick={() => { sfx.click(); handleNewFromTemplate(tmpl.title, tmpl.script); }}
                  onMouseEnter={sfx.hover}
                  style={{
                    padding: '6px 12px',
                    background: theme.mode === 'dark' ? 'rgba(26,25,24,0.7)' : theme.mode === 'fade' ? 'rgba(255,255,255,0.2)' : 'rgba(250,249,246,0.6)',
                    border: `1px solid ${theme.cardBorder}`,
                    borderRadius: 8,
                    cursor: 'pointer',
                    fontFamily: "'Inter', system-ui, sans-serif",
                    fontSize: '13px',
                    color: theme.text,
                    transition: 'all 0.15s, background 0.5s, border-color 1.5s, color 1.5s',
                    backdropFilter: 'blur(12px)',
                    WebkitBackdropFilter: 'blur(12px)',
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: '13px' }}>{tmpl.title}</div>
                  <div style={{ fontSize: '12px', opacity: 0.4, marginTop: 1 }}>{tmpl.description}</div>
                </button>
              ))}
            </div>
          )}

          {/* Sketch count label */}
          {user && sketches.length > 0 && (
            <div style={{
              fontSize: '12px',
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              opacity: 0.35,
              fontWeight: 600,
              marginBottom: 12,
              textAlign: 'center',
            }}>
              {sketches.length} sketch{sketches.length !== 1 ? 'es' : ''}
            </div>
          )}

          {/* New Sketch — centered */}
          {user && sketches.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
              <button
                className="new-btn"
                onClick={() => { sfx.click(); handleNew(); }}
                onMouseEnter={sfx.hover}
                style={{ ...styles.newBtn, background: theme.invertedBg, color: theme.invertedText, transition: 'background 0.3s, color 0.3s' }}
              >
                + New Sketch
              </button>
            </div>
          )}

          {user && sketches.length === 0 && !loadingSketches && (
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
              <button
                className="new-btn"
                onClick={() => { sfx.click(); handleNew(); }}
                onMouseEnter={sfx.hover}
                style={{ ...styles.newBtn, background: theme.invertedBg, color: theme.invertedText, transition: 'background 0.3s, color 0.3s' }}
              >
                + New Sketch
              </button>
            </div>
          )}

          <div style={{
            display: 'grid',
            gridTemplateColumns: `repeat(auto-fill, ${CARD_W}px)`,
            gap: 16,
            justifyContent: 'center',
          }}>
            {user && sketches.map((sketch) => (
              <SketchCard
                key={sketch.id}
                sketch={sketch}
                theme={theme}
                onOpen={() => navigate(`/editor/${sketch.id}`)}
                onDelete={() => handleDelete(sketch.id)}
                onRename={(title) => handleRename(sketch.id, title)}
                sfx={sfx}
              />
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: '100vw',
    height: '100vh',
    background: '#f4f3ee',
    fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
    color: '#0a0a0a',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  newBtn: {
    padding: '7px 18px',
    background: '#0a0a0a',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: '14px',
    fontFamily: "'Inter', system-ui, sans-serif",
    color: '#faf9f6',
    fontWeight: 500,
  },
  content: {
    flex: 1,
    overflow: 'auto',
    padding: '32px 48px',
    position: 'relative',
    zIndex: 1,
  },
  welcome: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    textAlign: 'center' as const,
  },
  welcomeTitle: {
    fontSize: '18px',
    fontWeight: 600,
    marginBottom: '8px',
  },
  welcomeSubtitle: {
    fontSize: '15px',
    opacity: 0.5,
    marginBottom: '20px',
  },
  welcomeBtn: {
    padding: '8px 24px',
    background: '#0a0a0a',
    border: 'none',
    borderRadius: 10,
    cursor: 'pointer',
    fontSize: '15px',
    fontFamily: "'Inter', system-ui, sans-serif",
    color: '#faf9f6',
    fontWeight: 500,
  },
  loadingText: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    fontSize: '16px',
    opacity: 0.4,
  },
};
