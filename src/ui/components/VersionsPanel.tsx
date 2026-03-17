import { useState, useEffect, useCallback } from 'react';
import { getVersions } from '../../lib/versions';
import type { SketchVersion } from '../../lib/supabase';

interface VersionsPanelProps {
  sketchId: string | undefined;
  onRestore: (script: string, title: string) => void;
}

export function VersionsPanel({ sketchId, onRestore }: VersionsPanelProps) {
  const [versions, setVersions] = useState<SketchVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    if (!sketchId) return;
    setLoading(true);
    getVersions(sketchId)
      .then(setVersions)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [sketchId]);

  const handleRestore = useCallback((v: SketchVersion) => {
    if (confirm(`Restore version ${v.version_number}? This will replace the current script.`)) {
      onRestore(v.script, v.title);
    }
  }, [onRestore]);

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
      ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  };

  if (!sketchId) {
    return (
      <div style={styles.empty}>
        Save your sketch first to enable versioning.
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {loading && <div style={styles.empty}>loading...</div>}

      {!loading && versions.length === 0 && (
        <div style={styles.empty}>
          No versions yet. Versions are saved each time you hit Save.
        </div>
      )}

      {versions.map((v) => (
        <div key={v.id} style={styles.item}>
          <div
            style={styles.itemHeader}
            onClick={() => setExpanded(expanded === v.id ? null : v.id)}
          >
            <div style={styles.versionBadge}>v{v.version_number}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '11px', fontWeight: 500 }}>{v.title}</div>
              <div style={{ fontSize: '9px', opacity: 0.35 }}>{formatDate(v.created_at)}</div>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); handleRestore(v); }}
              style={styles.restoreBtn}
            >
              restore
            </button>
          </div>

          {expanded === v.id && (
            <pre style={styles.scriptPreview}>
              {v.script.slice(0, 500)}{v.script.length > 500 ? '\n...' : ''}
            </pre>
          )}
        </div>
      ))}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: '6px 10px',
    fontFamily: "'SF Mono', 'Consolas', monospace",
    fontSize: '11px',
    color: '#1a3a2a',
    overflow: 'auto',
    height: '100%',
  },
  empty: {
    padding: '16px',
    fontSize: '10px',
    opacity: 0.3,
    textAlign: 'center',
    fontFamily: "'Inter', system-ui, sans-serif",
  },
  item: {
    borderBottom: '1px solid #e8e0d8',
    paddingBottom: '6px',
    marginBottom: '6px',
  },
  itemHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    cursor: 'pointer',
    padding: '4px 0',
  },
  versionBadge: {
    fontSize: '9px',
    fontWeight: 700,
    background: '#1a3a2a',
    color: '#faf9f6',
    padding: '1px 6px',
    borderRadius: 4,
    flexShrink: 0,
  },
  restoreBtn: {
    padding: '2px 8px',
    background: 'none',
    border: '1px solid #d0cdc4',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: '9px',
    fontFamily: "'Inter', system-ui, sans-serif",
    color: '#1a3a2a',
    opacity: 0.5,
    flexShrink: 0,
  },
  scriptPreview: {
    fontSize: '9px',
    fontFamily: "'SF Mono', monospace",
    background: '#faf9f6',
    border: '1px solid #e8e0d8',
    borderRadius: 6,
    padding: '8px',
    overflow: 'auto',
    maxHeight: 120,
    whiteSpace: 'pre-wrap',
    margin: '6px 0 0',
    opacity: 0.5,
  },
};
