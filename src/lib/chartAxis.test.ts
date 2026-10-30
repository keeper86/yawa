import { describe, expect, it } from 'vitest';
import {
    axisForScale,
    canUseLog,
    linearDomain,
    logAxisForRange,
    logDecadeTicks,
    planAxis,
    trimmedLogAxis,
} from './chartAxis';

describe('logDecadeTicks', () => {
    it('emits one power of ten per decade between the bounds', () => {
        expect(logDecadeTicks(1, 1000)).toEqual([1, 10, 100, 1000]);
        expect(logDecadeTicks(100, 1000)).toEqual([100, 1000]);
    });

    it('snaps the bounds outward to whole decades', () => {
        expect(logDecadeTicks(2, 100)).toEqual([1, 10, 100]);
        expect(logDecadeTicks(5, 6000)).toEqual([1, 10, 100, 1000, 10000]);
    });
});

describe('logAxisForRange', () => {
    it('anchors the domain on the outermost ticks', () => {
        expect(logAxisForRange(2, 100)).toEqual({ ticks: [1, 10, 100], domain: [1, 100] });
    });
});

describe('trimmedLogAxis', () => {
    it('ignores non-positive and non-finite values', () => {
        expect(trimmedLogAxis([0, -5, Number.NaN, Number.POSITIVE_INFINITY])).toBeNull();
    });

    it('returns null when there is nothing to spread', () => {
        expect(trimmedLogAxis([])).toBeNull();
        expect(trimmedLogAxis([42])).toBeNull();
        expect(trimmedLogAxis([5, 5, 5])).toBeNull();
    });

    it('returns null while the spread stays within one order of magnitude', () => {
        expect(trimmedLogAxis([1, 10])).toBeNull();
        expect(trimmedLogAxis([3, 30])).toBeNull();
    });

    it('returns decade ticks once the spread exceeds one order of magnitude', () => {
        expect(trimmedLogAxis([1, 10, 100, 1000, 10000])).toEqual({
            ticks: [1, 10, 100, 1000, 10000],
            domain: [1, 10000],
        });
    });

    it('drops the two lowest and two highest magnitudes before deciding', () => {
        expect(trimmedLogAxis([1, 2, 3, 4, 5, 6, 100, 200, 300, 400, 500, 600])).toEqual({
            ticks: [1, 10, 100, 1000],
            domain: [1, 1000],
        });
    });
});

describe('linearDomain', () => {
    it('pads the range of the values', () => {
        const [lo, hi] = linearDomain([0, 10]);
        expect(lo).toBeCloseTo(-0.8);
        expect(hi).toBeCloseTo(10.8);
    });

    it('opens a window around a single repeated value', () => {
        const [lo, hi] = linearDomain([5, 5, 5]);
        expect(lo).toBeLessThan(5);
        expect(hi).toBeGreaterThan(5);
        expect(hi - lo).toBeGreaterThan(0);
    });

    it('falls back to a unit window when nothing is finite', () => {
        expect(linearDomain([Number.NaN])).toEqual([0, 1]);
    });
});

describe('planAxis', () => {
    it('chooses log when the values span more than a decade', () => {
        const plan = planAxis([0.001, 0.01, 0.1, 1], { allowLog: true });
        expect(plan.scale).toBe('log');
        expect(plan.domain).toEqual([0.001, 1]);
        expect(plan.ticks).toEqual([0.001, 0.01, 0.1, 1]);
    });

    it('logs the quartering error series, which spans more than a decade', () => {
        const plan = planAxis([0.1667, 0.0417, 0.0104], { allowLog: true });
        expect(plan.scale).toBe('log');
        expect(plan.canSwitch).toBe(true);
    });

    it('never logs bars', () => {
        const plan = planAxis([0.001, 0.01, 1], { allowLog: false });
        expect(plan.scale).toBe('linear');
        expect(plan.canSwitch).toBe(false);
    });

    it('refuses to log values at or below zero', () => {
        const plan = planAxis([-1, 0, 10], { allowLog: true });
        expect(plan.scale).toBe('linear');
        expect(plan.canSwitch).toBe(false);
    });
});

describe('axisForScale', () => {
    it('anchors a log axis on the data range rather than the auto domain', () => {
        expect(axisForScale([0.4, 0.1, 0.02], 'log')).toEqual({ domain: [0.01, 1], ticks: [0.01, 0.1, 1] });
    });

    it('falls back to the linear domain for non-positive values', () => {
        const axis = axisForScale([-2, 4], 'log');
        expect(axis.ticks).toBeNull();
        expect(axis.domain[0]).toBeCloseTo(-2.48);
    });
});

describe('canUseLog', () => {
    it('is true only for at least two positive values spanning a decade', () => {
        expect(canUseLog([1, 0.01])).toBe(true);
        expect(canUseLog([1, 2])).toBe(false);
        expect(canUseLog([0, 1])).toBe(false);
    });
});
