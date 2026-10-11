import { describe, expect, it } from 'vitest';
import { START_YEAR } from '@/lib/timeline';
import { liveYearX } from './chartTime';

describe('liveYearX', () => {
    it('maps a tick to a fractional calendar year', () => {
        expect(liveYearX(1)).toBe(START_YEAR);
        expect(liveYearX(31)).toBeCloseTo(START_YEAR + 1 / 12, 6);
        expect(liveYearX(361)).toBe(START_YEAR + 1);
    });

    it('advances within a month and within a year', () => {
        expect(liveYearX(30)).toBeCloseTo(START_YEAR + 29 / 30 / 12, 6);
        expect(liveYearX(360)).toBeCloseTo(START_YEAR + (11 + 29 / 30) / 12, 6);
    });

    it('is strictly ahead of the last completed year boundary', () => {
        expect(liveYearX(30)).toBeGreaterThan(START_YEAR);
        expect(liveYearX(30)).toBeLessThan(START_YEAR + 1);
    });
});
