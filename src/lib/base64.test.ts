import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { bytesToBase64Chars } from './base64';

describe('bytesToBase64Chars', () => {
    it('returns zero for an empty payload', () => {
        expect(bytesToBase64Chars(0)).toBe(0);
    });

    it('rounds up to whole base64 quartets', () => {
        expect(bytesToBase64Chars(1)).toBe(4);
        expect(bytesToBase64Chars(2)).toBe(4);
        expect(bytesToBase64Chars(3)).toBe(4);
        expect(bytesToBase64Chars(4)).toBe(8);
    });

    it('matches the encoded length of real buffers', () => {
        for (const size of [0, 1, 2, 3, 4, 5, 100, 1023, 1024, 1025]) {
            expect(bytesToBase64Chars(size)).toBe(Buffer.alloc(size).toString('base64').length);
        }
    });
});
