import { describe, expect, it } from 'vitest';
import { foldText } from './text';

describe('foldText', () => {
    it('lowercases and trims', () => {
        expect(foldText('  Test User ')).toBe('test user');
    });

    it('strips diacritics but keeps the rest of the word', () => {
        expect(foldText('Größenordnung')).toBe('großenordnung');
        expect(foldText('Äquivalenz')).toBe('aquivalenz');
        expect(foldText('Café')).toBe('cafe');
    });

    it('keeps spaces, punctuation and symbols, unlike a slug', () => {
        expect(foldText('O(h²) & Weg')).toBe('o(h²) & weg');
    });
});
