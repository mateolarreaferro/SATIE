import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../lib/AuthContext';
import { getPublicSketches } from '../../lib/sketches';
import type { Sketch } from '../../lib/supabase';

function SketchCard({ sketch, onClick }: { sketch: Sketch; onClick: () => void }) {
  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <div
      onClick={onClick}
      style={{
        background: '#faf9f6',
        border: '1.5px solid #d0cdc4',
        borderRadius: 16,
        padding: '20px',
        cursor: 'pointer',
        transition: 'box-shadow 0.2s, border-color 0.2s, transform 0.15s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = '0 4px 24px rgba(0,0,0,0.08)';
        e.currentTarget.style.borderColor = '#1a3a2a';
        e.currentTarget.style.transform = 'translateY(-2px)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = '0 2px 12px rgba(0,0,0,0.03)';
        e.currentTarget.style.borderColor = '#d0cdc4';
        e.currentTarget.style.transform = 'translateY(0)';
      }}
    >
      <div style={{
        fontSize: '14px',
        fontWeight: 600,
        color: '#0a0a0a',
        marginBottom: '8px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {sketch.title}
      </div>

      <pre style={{
        fontSize: '10px',
        fontFamily: "'SF Mono', 'Consolas', monospace",
        opacity: 0.35,
        whiteSpace: 'pre-wrap',
        overflow: 'hidden',
        maxHeight: 48,
        margin: '0 0 12px',
        color: '#0a0a0a',
      }}>
        {sketch.script.slice(0, 100)}
        {sketch.script.length > 100 ? '...' : ''}
      </pre>

      <div style={{
        display: 'flex',
        gap: '8px',
        fontSize: '10px',
        opacity: 0.3,
        color: '#0a0a0a',
      }}>
        <span>{formatDate(sketch.updated_at)}</span>
        {(sketch.like_count ?? 0) > 0 && <span>{sketch.like_count} likes</span>}
        {(sketch.fork_count ?? 0) > 0 && <span>{sketch.fork_count} forks</span>}
      </div>
    </div>
  );
}

export function Gallery() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [sketches, setSketches] = useState<Sketch[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getPublicSketches()
      .then(setSketches)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div style={{
      width: '100vw',
      minHeight: '100vh',
      background: '#f4f3ee',
      fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
      color: '#0a0a0a',
    }}>
      {/* Header */}
      <header style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '16px 32px',
        borderBottom: '1px solid #d0cdc4',
      }}>
        <Link to="/" style={{ textDecoration: 'none', color: '#0a0a0a' }}>
          <div style={{ fontSize: '16px', fontWeight: 700, letterSpacing: '0.04em' }}>
            satie
          </div>
        </Link>

        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <span style={{ fontSize: '13px', fontWeight: 500, opacity: 0.5 }}>explore</span>
          {user ? (
            <Link to="/" style={{
              fontSize: '11px',
              color: '#0a0a0a',
              opacity: 0.4,
              textDecoration: 'none',
            }}>
              Dashboard
            </Link>
          ) : (
            <Link to="/" style={{
              fontSize: '11px',
              color: '#0a0a0a',
              opacity: 0.4,
              textDecoration: 'none',
            }}>
              Sign in
            </Link>
          )}
        </div>
      </header>

      {/* Content */}
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px' }}>
        <h1 style={{
          fontSize: '20px',
          fontWeight: 600,
          marginBottom: '8px',
        }}>
          Public Sketches
        </h1>
        <p style={{
          fontSize: '13px',
          opacity: 0.4,
          marginBottom: '32px',
        }}>
          Spatial audio compositions shared by the community.
        </p>

        {loading && (
          <div style={{ textAlign: 'center', opacity: 0.4, fontSize: '12px', marginTop: '80px' }}>
            loading...
          </div>
        )}

        {!loading && sketches.length === 0 && (
          <div style={{ textAlign: 'center', opacity: 0.4, fontSize: '13px', marginTop: '80px' }}>
            No public sketches yet. Be the first to share one.
          </div>
        )}

        {!loading && sketches.length > 0 && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: '16px',
          }}>
            {sketches.map((sketch) => (
              <SketchCard
                key={sketch.id}
                sketch={sketch}
                onClick={() => navigate(`/s/${sketch.id}`)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
