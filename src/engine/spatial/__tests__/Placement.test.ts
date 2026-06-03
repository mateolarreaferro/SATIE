import { describe, it, expect } from 'vitest';
import { resolvePlacement, SEMANTIC_MOTIONS, defaultRegionFor, isSemanticMotion } from '../Placement';
import { WanderType } from '../../core/Statement';

describe('resolvePlacement', () => {
  it('ahead is in front (+Z), centered on X', () => {
    const { min, max } = resolvePlacement('ahead', 'mid');
    expect(min.z).toBeGreaterThan(0);
    expect(min.x).toBeLessThan(0);
    expect(max.x).toBeGreaterThan(0);
    expect((min.x + max.x) / 2).toBeCloseTo(0, 5);
  });

  it('depth scales distance monotonically', () => {
    const near = resolvePlacement('ahead', 'near');
    const mid = resolvePlacement('ahead', 'mid');
    const far = resolvePlacement('ahead', 'far');
    expect(mid.min.z).toBeGreaterThan(near.max.z);
    expect(far.min.z).toBeGreaterThan(mid.max.z);
  });

  it('keeps everything within the ~8m musical range', () => {
    for (const sector of ['ahead', 'behind', 'left', 'right', 'surround', 'overhead'] as const) {
      const { min, max } = resolvePlacement(sector, 'far', 'high', 'wide');
      for (const v of [min.x, min.y, min.z, max.x, max.y, max.z]) {
        expect(Math.abs(v)).toBeLessThanOrEqual(8);
      }
    }
  });

  it('height bands are ordered low < level < high', () => {
    const low = resolvePlacement('ahead', 'mid', 'low');
    const level = resolvePlacement('ahead', 'mid', 'level');
    const high = resolvePlacement('ahead', 'mid', 'high');
    expect(low.max.y).toBeLessThanOrEqual(level.max.y);
    expect(level.max.y).toBeLessThan(high.min.y);
  });

  it('diagonal sectors offset both axes', () => {
    const { min, max } = resolvePlacement('ahead-right', 'mid');
    expect((min.x + max.x) / 2).toBeGreaterThan(0); // right → +X
    expect((min.z + max.z) / 2).toBeGreaterThan(0); // ahead → +Z
  });
});

describe('SEMANTIC_MOTIONS', () => {
  it('every verb has a default region that resolves in-range', () => {
    for (const verb of Object.keys(SEMANTIC_MOTIONS)) {
      expect(isSemanticMotion(verb)).toBe(true);
      const { min, max } = defaultRegionFor(SEMANTIC_MOTIONS[verb]);
      expect(max.x).toBeGreaterThanOrEqual(min.x);
      expect(max.y).toBeGreaterThanOrEqual(min.y);
      expect(max.z).toBeGreaterThanOrEqual(min.z);
    }
  });

  it('ambient beds drift, ground agents walk, birds dart fast', () => {
    expect(SEMANTIC_MOTIONS.drift.wanderType).toBe(WanderType.Fly);
    expect(SEMANTIC_MOTIONS.wander.wanderType).toBe(WanderType.Walk);
    expect(SEMANTIC_MOTIONS.dart.hz).toBeGreaterThan(SEMANTIC_MOTIONS.drift.hz);
    expect(SEMANTIC_MOTIONS.static.wanderType).toBe(WanderType.Fixed);
  });
});
