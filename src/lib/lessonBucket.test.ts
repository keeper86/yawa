import { describe, expect, it } from 'vitest';
import { masteryBucket } from './lessonBucket';

describe('masteryBucket', () => {
    it('puts a learner below 0.4 in the novice bucket', () => {
        expect(masteryBucket(0)).toBe('novice');
        expect(masteryBucket(0.39)).toBe('novice');
    });

    it('moves to developing from 0.4 up to 0.75', () => {
        expect(masteryBucket(0.4)).toBe('developing');
        expect(masteryBucket(0.74)).toBe('developing');
    });

    it('treats 0.75 and above as fluent', () => {
        expect(masteryBucket(0.75)).toBe('fluent');
        expect(masteryBucket(1)).toBe('fluent');
    });
});
