/**
 * Feedback Effectiveness Dashboard — advanced view showing which
 * compositional patterns the adaptive AI system has learned to
 * boost or avoid based on RLHF feedback.
 */

import { useState, useEffect } from 'react';
import { buildAdaptiveSystemPrompt, checkLibrary, type PromptEffectiveness } from '../../lib/aiGenerate';
import type { Theme } from '../hooks/useDayNightCycle';

interface FeedbackDashboardProps {
  theme: Theme;
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

export function FeedbackDashboard({ theme }: FeedbackDashboardProps) {
  const [effectiveness, setEffectiveness] = useState<PromptEffectiveness[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    buildAdaptiveSystemPrompt([], checkLibrary('', []))
      .then(({ effectiveness: eff }) => {
        if (!cancelled) {
          setEffectiveness(eff.sort((a, b) => b.sampleSize - a.sampleSize));
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const totalSamples = effectiveness.reduce((sum, e) => sum + e.sampleSize, 0);
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
            {totalSamples} feedback signals analyzed
          </div>

          {effectiveness.map((e) => {
            const label = PATTERN_LABELS[e.patternName] ?? e.patternName;
            const pct = Math.round(e.successRate * 100);
            const barColor = e.sampleSize < 2
              ? `${theme.text}20`  // insufficient data — gray
              : e.successRate >= 0.7
                ? '#2d6a4f'  // boosted — green
                : e.successRate <= 0.3
                  ? '#8b0000'  // warned — red
                  : `${theme.text}40`;  // neutral

            const statusLabel = e.sampleSize < 2
              ? 'insufficient data'
              : e.successRate >= 0.7
                ? 'boosted'
                : e.successRate <= 0.3
                  ? 'avoided'
                  : 'neutral';

            return (
              <div key={e.patternName} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {/* Label */}
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

                {/* Bar */}
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

                {/* Percentage + status */}
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
            Patterns above 70% are emphasized in AI prompts.
            Below 30% are flagged as caution. Rate more generations to refine.
          </div>
        </div>
      )}
    </div>
  );
}
