import { describe, expect, it } from 'vitest';
import { slugify } from './slug';

describe('slugify', () => {
    it('lowercases and hyphenates words', () => {
        expect(slugify('Numerische Integration')).toBe('numerische-integration');
        expect(slugify('  Simpson-Regel  ')).toBe('simpson-regel');
    });

    it('folds german umlauts and eszett', () => {
        expect(slugify('Größenordnung')).toBe('grossenordnung');
        expect(slugify('Straße und Weg')).toBe('strasse-und-weg');
        expect(slugify('Äquivalenz von Normen')).toBe('aquivalenz-von-normen');
    });

    it('collapses punctuation and symbols into single hyphens', () => {
        expect(slugify('O(h²)')).toBe('o-h');
        expect(slugify('Satz 3.4: Konvergenz!')).toBe('satz-3-4-konvergenz');
        expect(slugify('a & b')).toBe('a-b');
    });

    it('trims leading and trailing hyphens', () => {
        expect(slugify('--trapezregel--')).toBe('trapezregel');
        expect(slugify('(Klammer)')).toBe('klammer');
    });

    it('returns an empty string when nothing survives', () => {
        expect(slugify('!!!')).toBe('');
        expect(slugify('')).toBe('');
    });

    it('caps the slug at 120 characters without a trailing hyphen', () => {
        const long = 'wort '.repeat(60).trim();
        const slug = slugify(long);
        expect(slug.length).toBeLessThanOrEqual(120);
        expect(slug.endsWith('-')).toBe(false);
    });
});
