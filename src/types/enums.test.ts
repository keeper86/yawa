import { describe, expect, it } from 'vitest';
import { sourceKindSchema } from './enums';

describe('enum schemas', () => {
    it('accepts every source kind the database allows', () => {
        for (const kind of ['wikipedia', 'upload', 'paste']) {
            expect(sourceKindSchema.safeParse(kind).success).toBe(true);
        }
    });

    it('rejects a source kind the database would refuse', () => {
        expect(sourceKindSchema.safeParse('pdf').success).toBe(false);
        expect(sourceKindSchema.safeParse('').success).toBe(false);
        expect(sourceKindSchema.safeParse(undefined).success).toBe(false);
    });
});
