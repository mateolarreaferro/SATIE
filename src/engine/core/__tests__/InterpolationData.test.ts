import { describe, it, expect } from 'vitest';
import { InterpolationData, ModulationType, LoopMode } from '../InterpolationData';

describe('InterpolationData', () => {
  describe('parse fade', () => {
    it('basic two-value fade', () => {
      const r = InterpolationData.parse('fade 0 1 every 2');
      expect(r).not.toBeNull();
      expect(r!.modulationType).toBe(ModulationType.Fade);
      expect(r!.values).toEqual([0, 1]);
      expect(r!.every.min).toBe(2);
      expect(r!.loopMode).toBe(LoopMode.None);
    });

    it('multi-value fade', () => {
      const r = InterpolationData.parse('fade 0.1 0.5 1 2 every 2');
      expect(r).not.toBeNull();
      expect(r!.modulationType).toBe(ModulationType.Fade);
      expect(r!.values).toEqual([0.1, 0.5, 1, 2]);
      expect(r!.every.min).toBe(2);
    });

    it('fade with decimal values', () => {
      const r = InterpolationData.parse('fade 0.25 0.75 every 3');
      expect(r).not.toBeNull();
      expect(r!.values).toEqual([0.25, 0.75]);
      expect(r!.every.min).toBe(3);
    });

    it('fade with loop bounce', () => {
      const r = InterpolationData.parse('fade 0 1 every 1 loop bounce');
      expect(r).not.toBeNull();
      expect(r!.modulationType).toBe(ModulationType.Fade);
      expect(r!.loopMode).toBe(LoopMode.Bounce);
      expect(r!.values).toEqual([0, 1]);
      expect(r!.every.min).toBe(1);
    });

    it('fade with loop restart', () => {
      const r = InterpolationData.parse('fade 0 1 every 4 loop restart');
      expect(r).not.toBeNull();
      expect(r!.loopMode).toBe(LoopMode.Restart);
    });
  });

  describe('parse jump', () => {
    it('basic two-value jump', () => {
      const r = InterpolationData.parse('jump 0 1 every 2');
      expect(r).not.toBeNull();
      expect(r!.modulationType).toBe(ModulationType.Jump);
      expect(r!.values).toEqual([0, 1]);
      expect(r!.every.min).toBe(2);
      expect(r!.loopMode).toBe(LoopMode.None);
    });

    it('multi-value jump', () => {
      const r = InterpolationData.parse('jump 0.1 0.5 1 2 every 2');
      expect(r).not.toBeNull();
      expect(r!.modulationType).toBe(ModulationType.Jump);
      expect(r!.values).toEqual([0.1, 0.5, 1, 2]);
    });

    it('jump with loop restart and range interval', () => {
      const r = InterpolationData.parse('jump 2 3 every 5to14 loop restart');
      expect(r).not.toBeNull();
      expect(r!.modulationType).toBe(ModulationType.Jump);
      expect(r!.loopMode).toBe(LoopMode.Restart);
      expect(r!.every.isRange).toBe(true);
      expect(r!.every.min).toBe(5);
      expect(r!.every.max).toBe(14);
    });

    it('jump with loop bounce', () => {
      const r = InterpolationData.parse('jump 10 20 every 1 loop bounce');
      expect(r).not.toBeNull();
      expect(r!.modulationType).toBe(ModulationType.Jump);
      expect(r!.loopMode).toBe(LoopMode.Bounce);
    });
  });

  describe('loop modes', () => {
    it('defaults to LoopMode.None when no loop keyword', () => {
      const r = InterpolationData.parse('fade 0 1 every 2');
      expect(r!.loopMode).toBe(LoopMode.None);
    });

    it('bounce loop mode', () => {
      const r = InterpolationData.parse('fade 0 1 every 2 loop bounce');
      expect(r!.loopMode).toBe(LoopMode.Bounce);
    });

    it('restart loop mode', () => {
      const r = InterpolationData.parse('fade 0 1 every 2 loop restart');
      expect(r!.loopMode).toBe(LoopMode.Restart);
    });

    it('loop mode works for both fade and jump', () => {
      const fade = InterpolationData.parse('fade 0 1 every 1 loop bounce');
      const jump = InterpolationData.parse('jump 0 1 every 1 loop bounce');
      expect(fade!.loopMode).toBe(LoopMode.Bounce);
      expect(jump!.loopMode).toBe(LoopMode.Bounce);
    });
  });

  describe('range intervals', () => {
    it('parses range interval with "to" syntax', () => {
      const r = InterpolationData.parse('fade 0 1 every 5to14');
      expect(r).not.toBeNull();
      expect(r!.every.isRange).toBe(true);
      expect(r!.every.min).toBe(5);
      expect(r!.every.max).toBe(14);
    });

    it('parses fixed interval as non-range', () => {
      const r = InterpolationData.parse('fade 0 1 every 3');
      expect(r).not.toBeNull();
      expect(r!.every.isRange).toBe(false);
      expect(r!.every.min).toBe(3);
    });

    it('range interval with loop mode', () => {
      const r = InterpolationData.parse('jump 2 3 every 5to14 loop restart');
      expect(r).not.toBeNull();
      expect(r!.every.isRange).toBe(true);
      expect(r!.every.min).toBe(5);
      expect(r!.every.max).toBe(14);
      expect(r!.loopMode).toBe(LoopMode.Restart);
    });
  });

  describe('minValue and maxValue getters', () => {
    it('minValue returns first value', () => {
      const r = InterpolationData.parse('fade 0.1 0.5 1 2 every 1');
      expect(r!.minValue).toBe(0.1);
    });

    it('maxValue returns last value', () => {
      const r = InterpolationData.parse('fade 0.1 0.5 1 2 every 1');
      expect(r!.maxValue).toBe(2);
    });

    it('minValue and maxValue with two values', () => {
      const r = InterpolationData.parse('jump 5 10 every 1');
      expect(r!.minValue).toBe(5);
      expect(r!.maxValue).toBe(10);
    });

    it('minValue and maxValue when first > last', () => {
      const r = InterpolationData.parse('fade 10 5 every 1');
      expect(r!.minValue).toBe(10);
      expect(r!.maxValue).toBe(5);
    });
  });

  describe('invalid input', () => {
    it('returns null for empty string', () => {
      expect(InterpolationData.parse('')).toBeNull();
    });

    it('returns null for whitespace-only string', () => {
      expect(InterpolationData.parse('   ')).toBeNull();
    });

    it('returns null for plain number', () => {
      expect(InterpolationData.parse('0.5')).toBeNull();
    });

    it('returns null for unrecognized keyword', () => {
      expect(InterpolationData.parse('slide 0 1 every 2')).toBeNull();
    });

    it('returns null for garbage input', () => {
      expect(InterpolationData.parse('not a modulation')).toBeNull();
    });

    it('returns null when fewer than 2 values for fade', () => {
      expect(InterpolationData.parse('fade 1 every 2')).toBeNull();
    });

    it('returns null when fewer than 2 values for jump', () => {
      expect(InterpolationData.parse('jump 5 every 3')).toBeNull();
    });

    it('returns null when missing every keyword', () => {
      expect(InterpolationData.parse('fade 0 1')).toBeNull();
    });

    it('returns null when missing duration after every', () => {
      expect(InterpolationData.parse('fade 0 1 every')).toBeNull();
    });
  });

  describe('durationRange alias', () => {
    it('durationRange returns same value as every', () => {
      const r = InterpolationData.parse('fade 0 1 every 5');
      expect(r!.durationRange).toBe(r!.every);
      expect(r!.durationRange.min).toBe(5);
    });
  });
});
