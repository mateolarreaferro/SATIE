import { useState, useCallback } from 'react';
import { SamplesTab, type SampleEntry } from './SamplesTab';
import { TrajectoriesTab } from './TrajectoriesTab';
import { CommunityTab } from './CommunityTab';
import { useTheme } from '../theme/ThemeContext';
import { RADIUS } from '../theme/tokens';

export type AssetTab = 'samples' | 'trajectories' | 'community';

interface AssetPanelProps {
  samples: SampleEntry[];
  onLoadBuffer: (name: string, data: ArrayBuffer, category?: SampleEntry['category']) => Promise<void>;
  onDeleteSample?: (name: string) => void;
  onPreviewSample?: (name: string) => void;
  onGenerateTrajectory?: (name: string, prompt: string) => void;
  generatingTrajectory?: string | null;
}

export function AssetPanel({
  samples,
  onLoadBuffer,
  onDeleteSample,
  onPreviewSample,
  onGenerateTrajectory,
  generatingTrajectory,
}: AssetPanelProps) {
  const [tab, setTab] = useState<AssetTab>('samples');
  const { theme } = useTheme();

  const tabBtnStyle = useCallback((active: boolean): React.CSSProperties => ({
    padding: '2px 8px',
    background: active ? theme.accent : 'none',
    color: active ? theme.accentText : theme.accent,
    border: `1px solid ${active ? theme.accent : theme.cardBorder}`,
    borderRadius: RADIUS.sm,
    cursor: 'pointer',
    fontSize: '16px',
    fontFamily: "'Inter', system-ui, sans-serif",
    fontWeight: 500,
    letterSpacing: '0.03em',
    transition: 'all 0.15s',
  }), [theme]);

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      fontFamily: "'Inter', system-ui, sans-serif",
      fontSize: '16px',
      color: theme.text,
    }}>
      {/* Tab bar */}
      <div style={{
        display: 'flex',
        gap: '4px',
        padding: '0 14px 6px',
        alignItems: 'center',
        flexShrink: 0,
      }}>
        <button onClick={() => setTab('samples')} style={tabBtnStyle(tab === 'samples')}>
          Samples
        </button>
        <button onClick={() => setTab('trajectories')} style={tabBtnStyle(tab === 'trajectories')}>
          Trajectories
        </button>
        <button onClick={() => setTab('community')} style={tabBtnStyle(tab === 'community')}>
          Community
        </button>
        <span style={{
          fontSize: '16px',
          opacity: 0.2,
          marginLeft: 'auto',
          fontFamily: "'SF Mono', monospace",
        }}>
          {tab === 'samples' ? `${samples.length}` : ''}
        </span>
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: 'hidden', padding: '0 14px 8px' }}>
        {tab === 'samples' ? (
          <SamplesTab
            samples={samples}
            onLoadBuffer={onLoadBuffer}
            onDelete={onDeleteSample}
            onPreview={onPreviewSample}
          />
        ) : tab === 'trajectories' ? (
          <TrajectoriesTab
            onGenerateTrajectory={onGenerateTrajectory}
            generatingTrajectory={generatingTrajectory}
          />
        ) : (
          <CommunityTab onLoadBuffer={onLoadBuffer} />
        )}
      </div>
    </div>
  );
}
