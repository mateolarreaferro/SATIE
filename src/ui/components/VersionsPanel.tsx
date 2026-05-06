import { useState, useEffect, useCallback } from 'react';
import { getVersions } from '../../lib/versions';
import { useTheme } from '../theme/ThemeContext';
import { Spinner } from './primitives';
import { RADIUS } from '../theme/tokens';
import type { SketchVersion } from '../../lib/supabase';

interface VersionsPanelProps {
  sketchId: string | undefined;
  onRestore: (script: string, title: string) => void;
}

export function VersionsPanel({ sketchId, onRestore }: VersionsPanelProps) {
  const [versions, setVersions] = useState<SketchVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const { theme } = useTheme();

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

  const emptyStyle: React.CSSProperties = {
    padding: '16px',
    fontSize: '15px',
    opacity: 0.45,
    textAlign: 'center',
    fontFamily: "'Inter', system-ui, sans-serif",
    color: theme.text,
  };

  if (!sketchId) {
    return <div style={emptyStyle}>Save your sketch first to enable versioning.</div>;
  }

  return (
    <div style={{
      padding: '6px 10px',
      fontFamily: "'SF Mono', 'Consolas', monospace",
      fontSize: '16px',
      color: theme.text,
      overflow: 'auto',
      height: '100%',
    }}>
      {loading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 16 }}>
          <Spinner size={20} />
        </div>
      )}

      {!loading && versions.length === 0 && (
        <div style={emptyStyle}>
          No versions yet. Versions are saved each time you hit Save.
        </div>
      )}

      {versions.map((v) => (
        <div key={v.id} style={{
          borderBottom: `1px solid ${theme.cardBorder}`,
          paddingBottom: 6,
          marginBottom: 6,
        }}>
          <div
            onClick={() => setExpanded(expanded === v.id ? null : v.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              cursor: 'pointer',
              padding: '4px 0',
            }}
          >
            <div style={{
              fontSize: '16px',
              fontWeight: 700,
              background: theme.accent,
              color: theme.accentText,
              padding: '1px 6px',
              borderRadius: 4,
              flexShrink: 0,
            }}>
              v{v.version_number}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '16px', fontWeight: 500 }}>{v.title}</div>
              <div style={{ fontSize: '16px', opacity: 0.55 }}>{formatDate(v.created_at)}</div>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); handleRestore(v); }}
              aria-label={`Restore version ${v.version_number}`}
              style={{
                padding: '2px 8px',
                background: 'none',
                border: `1px solid ${theme.cardBorder}`,
                borderRadius: RADIUS.sm,
                cursor: 'pointer',
                fontSize: '16px',
                fontFamily: "'Inter', system-ui, sans-serif",
                color: theme.text,
                opacity: 0.7,
                flexShrink: 0,
              }}
            >
              restore
            </button>
          </div>

          {expanded === v.id && (
            <pre style={{
              fontSize: '16px',
              fontFamily: "'SF Mono', monospace",
              background: theme.cardBgSubtle,
              border: `1px solid ${theme.cardBorder}`,
              borderRadius: RADIUS.sm,
              padding: '8px',
              overflow: 'auto',
              maxHeight: 120,
              whiteSpace: 'pre-wrap',
              margin: '6px 0 0',
              opacity: 0.85,
              color: theme.text,
            }}>
              {v.script.slice(0, 500)}{v.script.length > 500 ? '\n…' : ''}
            </pre>
          )}
        </div>
      ))}
    </div>
  );
}
