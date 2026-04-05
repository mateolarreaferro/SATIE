import { describe, it, expect } from 'vitest';
import { scoreScript, type ScriptScore } from '../aiGenerate';

describe('scoreScript', () => {
  it('returns zero score for empty input', () => {
    const score = scoreScript('');
    expect(score.parseValid).toBe(false);
    expect(score.total).toBe(0);
  });

  it('returns zero score for invalid syntax', () => {
    const score = scoreScript('this is not valid satie code!!!');
    expect(score.parseValid).toBe(false);
    expect(score.total).toBe(0);
  });

  it('scores a minimal valid script', () => {
    const score = scoreScript('loop rain\n');
    expect(score.parseValid).toBe(true);
    expect(score.voiceCount).toBe(1);
    expect(score.total).toBeGreaterThan(0);
  });

  it('scores higher with more voices', () => {
    const single = scoreScript('loop rain\n');
    const multi = scoreScript('loop rain\nloop wind\nloop bird\nloop thunder\n');
    expect(multi.total).toBeGreaterThan(single.total);
    expect(multi.voiceCount).toBe(4);
  });

  it('scores higher with count multipliers', () => {
    const single = scoreScript('loop rain\n');
    const multiplied = scoreScript('3 * loop rain\n');
    expect(multiplied.voiceCount).toBe(3);
    expect(multiplied.total).toBeGreaterThan(single.total);
  });

  it('detects DSP effects', () => {
    const score = scoreScript(`loop rain
    reverb 0.5 0.7 0.3
    delay 0.3 0.25 0.5
    filter lowpass cutoff 800
`);
    expect(score.detail.hasReverb).toBe(true);
    expect(score.detail.hasDelay).toBe(true);
    expect(score.detail.hasFilter).toBe(true);
    expect(score.dspRichness).toBe(1); // 3+ effects = max
  });

  it('detects spatial movement', () => {
    const noMove = scoreScript('loop rain\n');
    const withMove = scoreScript('loop rain\n    move fly x -10to10 y 0to5 z -10to10\n');
    expect(noMove.detail.hasMovement).toBe(false);
    expect(withMove.detail.hasMovement).toBe(true);
    expect(withMove.total).toBeGreaterThan(noMove.total);
  });

  it('detects trajectories', () => {
    const score = scoreScript('loop rain\n    move spiral speed 0.5\n');
    expect(score.detail.hasTrajectory).toBe(true);
    expect(score.detail.hasMovement).toBe(true);
  });

  it('detects interpolation', () => {
    const score = scoreScript('loop rain\n    volume fade 0 1 every 5\n');
    expect(score.detail.hasInterpolation).toBe(true);
    expect(score.interpolationUse).toBeGreaterThan(0);
  });

  it('detects ranges', () => {
    const score = scoreScript('loop rain\n    volume 0.3to0.7\n');
    expect(score.detail.hasRanges).toBe(true);
  });

  it('detects groups', () => {
    const score = scoreScript(`group
    volume 0.5
    loop rain
    loop wind
endgroup
`);
    expect(score.detail.hasGroups).toBe(true);
    expect(score.voiceCount).toBe(2);
  });

  it('spatial coverage increases with spread voices', () => {
    const clustered = scoreScript(`loop rain
    move fly x 0to1 y 0 z 0to1
loop wind
    move fly x 0to1 y 0 z 0to1
`);
    const spread = scoreScript(`loop rain
    move fly x -10to-5 y 0 z -10to-5
loop wind
    move fly x 5to10 y 3to5 z 5to10
`);
    expect(spread.spatialCoverage).toBeGreaterThan(clustered.spatialCoverage);
  });

  it('produces a rich score for a complex script', () => {
    const score = scoreScript(`group
    reverb 0.4 0.7 0.5

    3 * loop gen gentle rain
        volume 0.2to0.5
        move fly x -8to8 y 0to3 z -8to8 speed 0.5
        visual trail

    loop gen distant thunder
        volume fade 0.1 0.4 every 10 loop bounce
        move orbit speed 0.2
        delay 0.3 0.5 0.6
        visual trail
endgroup
`);
    expect(score.parseValid).toBe(true);
    expect(score.voiceCount).toBeGreaterThanOrEqual(4);
    expect(score.detail.hasReverb).toBe(true);
    expect(score.detail.hasDelay).toBe(true);
    expect(score.detail.hasMovement).toBe(true);
    expect(score.detail.hasTrajectory).toBe(true);
    expect(score.detail.hasGroups).toBe(true);
    expect(score.total).toBeGreaterThan(0.5);
  });
});
