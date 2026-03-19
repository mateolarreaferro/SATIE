import { describe, it, expect } from 'vitest';
import { SatieEngine } from '../SatieEngine';
import { InterpolationData, ModulationType, LoopMode } from '../InterpolationData';
import { RangeOrValue } from '../RangeOrValue';

describe('SatieEngine', () => {
  describe('evalModulation', () => {
    // Test the static evalModulation method directly

    describe('fade (continuous)', () => {
      it('two values, no loop — linear transition', () => {
        const mod = new InterpolationData([0, 1], RangeOrValue.single(5), ModulationType.Fade);
        expect(SatieEngine.evalModulation(mod, 0, 5)).toBeCloseTo(0);
        expect(SatieEngine.evalModulation(mod, 2.5, 5)).toBeCloseTo(0.5);
        expect(SatieEngine.evalModulation(mod, 5, 5)).toBeCloseTo(1);
        expect(SatieEngine.evalModulation(mod, 100, 5)).toBeCloseTo(1); // clamps at last
      });

      it('multi-value, no loop', () => {
        const mod = new InterpolationData([0, 0.5, 1], RangeOrValue.single(2), ModulationType.Fade);
        expect(SatieEngine.evalModulation(mod, 0, 2)).toBeCloseTo(0);
        expect(SatieEngine.evalModulation(mod, 1, 2)).toBeCloseTo(0.25);
        expect(SatieEngine.evalModulation(mod, 2, 2)).toBeCloseTo(0.5);
        expect(SatieEngine.evalModulation(mod, 3, 2)).toBeCloseTo(0.75);
        expect(SatieEngine.evalModulation(mod, 4, 2)).toBeCloseTo(1);
        expect(SatieEngine.evalModulation(mod, 10, 2)).toBeCloseTo(1);
      });

      it('loop bounce — oscillates', () => {
        const mod = new InterpolationData([0, 1], RangeOrValue.single(4), ModulationType.Fade, LoopMode.Bounce);
        expect(SatieEngine.evalModulation(mod, 0, 4)).toBeCloseTo(0);
        expect(SatieEngine.evalModulation(mod, 2, 4)).toBeCloseTo(0.5);
        expect(SatieEngine.evalModulation(mod, 4, 4)).toBeCloseTo(1); // peak
        expect(SatieEngine.evalModulation(mod, 6, 4)).toBeCloseTo(0.5); // returning
        // Full cycle = 2*(n-1)*every = 2*1*4 = 8
        expect(SatieEngine.evalModulation(mod, 8, 4)).toBeCloseTo(0); // back to start
      });

      it('loop restart — wraps around', () => {
        const mod = new InterpolationData([0, 1], RangeOrValue.single(4), ModulationType.Fade, LoopMode.Restart);
        expect(SatieEngine.evalModulation(mod, 0, 4)).toBeCloseTo(0);
        expect(SatieEngine.evalModulation(mod, 2, 4)).toBeCloseTo(0.5);
        // cycleDur = n*every = 2*4 = 8 for restart
        expect(SatieEngine.evalModulation(mod, 4, 4)).toBeCloseTo(1); // approaching wrap
      });
    });

    describe('jump (discrete)', () => {
      it('two values, no loop', () => {
        const mod = new InterpolationData([0.1, 0.9], RangeOrValue.single(3), ModulationType.Jump);
        expect(SatieEngine.evalModulation(mod, 0, 3)).toBe(0.1);
        expect(SatieEngine.evalModulation(mod, 2.9, 3)).toBe(0.1);
        expect(SatieEngine.evalModulation(mod, 3, 3)).toBe(0.9);
        expect(SatieEngine.evalModulation(mod, 100, 3)).toBe(0.9);
      });

      it('multi-value with loop restart', () => {
        const mod = new InterpolationData([1, 2, 3], RangeOrValue.single(2), ModulationType.Jump, LoopMode.Restart);
        expect(SatieEngine.evalModulation(mod, 0, 2)).toBe(1);
        expect(SatieEngine.evalModulation(mod, 2, 2)).toBe(2);
        expect(SatieEngine.evalModulation(mod, 4, 2)).toBe(3);
        expect(SatieEngine.evalModulation(mod, 6, 2)).toBe(1); // restart
      });

      it('multi-value with loop bounce', () => {
        const mod = new InterpolationData([1, 2, 3], RangeOrValue.single(2), ModulationType.Jump, LoopMode.Bounce);
        // bounce sequence: 1,2,3,2,1,2,3,...  (period = 2*(3-1) = 4 steps)
        expect(SatieEngine.evalModulation(mod, 0, 2)).toBe(1);
        expect(SatieEngine.evalModulation(mod, 2, 2)).toBe(2);
        expect(SatieEngine.evalModulation(mod, 4, 2)).toBe(3);
        expect(SatieEngine.evalModulation(mod, 6, 2)).toBe(2); // bouncing back
        expect(SatieEngine.evalModulation(mod, 8, 2)).toBe(1); // back to start
      });
    });

    describe('edge cases', () => {
      it('single value returns it', () => {
        const mod = new InterpolationData([0.5], RangeOrValue.single(5), ModulationType.Fade);
        expect(SatieEngine.evalModulation(mod, 0, 5)).toBe(0.5);
        expect(SatieEngine.evalModulation(mod, 100, 5)).toBe(0.5);
      });

      it('zero every returns first value', () => {
        const mod = new InterpolationData([0, 1], RangeOrValue.single(0), ModulationType.Fade);
        expect(SatieEngine.evalModulation(mod, 5, 0)).toBe(0);
      });

      it('empty values returns 0', () => {
        const mod = new InterpolationData([], RangeOrValue.single(5), ModulationType.Fade);
        expect(SatieEngine.evalModulation(mod, 5, 5)).toBe(0);
      });
    });
  });
});
