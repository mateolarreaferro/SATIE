/**
 * Feedback Effectiveness Dashboard — read-only view showing which
 * compositional patterns users prefer based on RLHF feedback data
 * stored in IndexedDB. Does NOT inject anything into AI prompts.
 */

import { useState, useEffect } from 'react';
import { getTopExamples, getAntiPatterns } from '../../lib/feedbackStore';
import type { Theme } from '../hooks/useDayNightCycle';

interface FeedbackDashboardProps {
  theme: Theme;
}

interface PatternStat {
  name: string;
  successRate: number;
  sampleSize: number;
}

const PATTERN_LABELS: Record<string, string> = {
  count_multiplier: 'Count multipliers (N *)',
  groups: 'Groups',
  reverb: 'Reverb',
  delay: 'Delay',
  filter: 'Filter',
  interpolation: 'Interpolation (fade/jump)',
  ranges: 'Ranges (0.3to0.7)',
  movement: 'Movement (walk/fly)',
  trajectory: 'Trajectories (spiral/orbit)',
  visual_trail: 'Visual trails',
  gen_audio: 'Generated audio (gen)',
  variables: 'Variables (let)',
};

const PATTERN_DETECTORS: { name: string; test: (code: string) => boolean }[] = [
  { name: 'count_multiplier', test: (c) => /\d+\s*\*\s*(loop|oneshot)/.test(c) },
  { name: 'groups', test: (c) => c.includes('group') && c.includes('endgroup') },
  { name: 'reverb', test: (c) => /reverb\s/.test(c) },
  { name: 'delay', test: (c) => /delay\s/.test(c) },
  { name: 'filter', test: (c) => /filter\s/.test(c) },
  { name: 'interpolation', test: (c) => /\b(fade|jump|gobetween|interpolate)\b/.test(c) },
  { name: 'ranges', test: (c) => /\d+to\d+/.test(c) },
  { name: 'movement', test: (c) => /move\s+(walk|fly|orbit|spiral|lorenz)/.test(c) },
  { name: 'trajectory', test: (c) => /move\s+(spiral|orbit|lorenz|gen)/.test(c) },
  { name: 'visual_trail', test: (c) => /visual\s+trail/.test(c) },
  { name: 'gen_audio', test: (c) => /\bgen\s+\w/.test(c) },
  { name: 'variables', test: (c) => /\blet\s+\w/.test(c) },
];

export function FeedbackDashboard({ theme }: FeedbackDashboardProps) {
  const [stats, setStats] = useState<PatternStat[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    // Analyze feedback data locally (IndexedDB only, no API calls)
    Promise.all([
      getTopExamples('script', 20),
      getAntiPatterns('script', 20),
    ]).then(([positive, negative]) => {
      if (cancelled) return;

      const results = PATTERN_DETECTORS.map(({ name, test }) => {
        const posHits = positive.filter(f => test(f.userEditedOutput ?? f.output)).length;
        const negHits = negative.filter(f => test(f.output)).length;
        const total = posHits + negHits;
        return {
          name,
          successRate: total > 0 ? posHits / total : 0.5,
          sampleSize: total,
        };
      });

      setStats(results.sort((a, b) => b.sampleSize - a.sampleSize));
      setLoading(false);
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, []);

  const totalSamples = stats.reduce((sum, e) => sum + e.sampleSize, 0);
  const hasFeedback = totalSamples > 0;

  return (
    <div style={{ maxWidth: 420 }}>
      {loading ? (
        <div style={{ fontSize: '13px', opacity: 0.3, padding: '4px 0' }}>analyzing feedback...</div>
      ) : !hasFeedback ? (
        <div style={{ fontSize: '13px', opacity: 0.3, padding: '4px 0', lineHeight: 1.5 }}>
          No feedback data yet. Rate AI generations with thumbs up/down
          in the editor to teach the system your preferences.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: '12px', opacity: 0.25, marginBottom: 2 }}>
            {totalSamples} feedback signals collected
          </div>

          {stats.map((e) => {
            const label = PATTERN_LABELS[e.name] ?? e.name;
            const pct = Math.round(e.successRate * 100);
            const barColor = e.sampleSize < 2
              ? `${theme.text}20`
              : e.successRate >= 0.7
                ? '#2d6a4f'
                : e.successRate <= 0.3
                  ? '#8b0000'
                  : `${theme.text}40`;

            const statusLabel = e.sampleSize < 2
              ? 'insufficient data'
              : e.successRate >= 0.7
                ? 'preferred'
                : e.successRate <= 0.3
                  ? 'disliked'
                  : 'neutral';

            return (
              <div key={e.name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                  fontSize: '12px',
                  fontFamily: "'SF Mono', monospace",
                  opacity: e.sampleSize < 2 ? 0.25 : 0.6,
                  width: 160,
                  flexShrink: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  color: theme.text,
                }}>
                  {label}
                </div>

                <div style={{
                  flex: 1,
                  height: 6,
                  background: `${theme.text}08`,
                  borderRadius: 3,
                  overflow: 'hidden',
                  position: 'relative',
                }}>
                  <div style={{
                    width: `${pct}%`,
                    height: '100%',
                    background: barColor,
                    borderRadius: 3,
                    transition: 'width 0.5s ease',
                  }} />
                </div>

                <div style={{
                  fontSize: '11px',
                  fontFamily: "'SF Mono', monospace",
                  opacity: e.sampleSize < 2 ? 0.2 : 0.4,
                  width: 90,
                  flexShrink: 0,
                  textAlign: 'right',
                  color: barColor === `${theme.text}20` ? theme.text : barColor,
                }}>
                  {e.sampleSize < 2 ? '—' : `${pct}%`}
                  <span style={{ opacity: 0.6, marginLeft: 4, fontSize: '10px' }}>
                    {statusLabel}
                  </span>
                </div>
              </div>
            );
          })}

          <div style={{
            fontSize: '11px',
            opacity: 0.2,
            marginTop: 4,
            lineHeight: 1.5,
          }}>
            Feedback is collected locally. Rate more generations to build a clearer picture of your preferences.
          </div>
        </div>
      )}
    </div>
  );
}
