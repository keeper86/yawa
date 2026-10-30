import { describe, expect, it } from 'vitest';
import { pasteExternalId, splitSections } from './sourceText';

describe('splitSections', () => {
    it('splits on blank lines and treats a short first line as a heading', () => {
        const sections = splitSections(
            'Trapezregel\nDie Flaeche wird durch Trapeze genaehert.\n\nSimpsonregel\nDie Flaeche wird durch Parabeln genaehert.',
        );

        expect(sections).toHaveLength(2);
        expect(sections[0].heading).toBe('Trapezregel');
        expect(sections[0].content).toBe('Die Flaeche wird durch Trapeze genaehert.');
        expect(sections[1].heading).toBe('Simpsonregel');
    });

    it('keeps a block without a heading intact', () => {
        const sections = splitSections('Ein einzelner Absatz ohne Ueberschrift.');

        expect(sections).toHaveLength(1);
        expect(sections[0].heading).toBe('');
        expect(sections[0].content).toBe('Ein einzelner Absatz ohne Ueberschrift.');
    });

    it('does not mistake a sentence ending in a full stop for a heading', () => {
        const sections = splitSections('Das ist ein Satz.\nUnd hier folgt der zweite Satz.');

        expect(sections[0].heading).toBe('');
        expect(sections[0].content).toBe('Das ist ein Satz.\nUnd hier folgt der zweite Satz.');
    });

    it('drops whitespace-only blocks and treats a lone line as content', () => {
        const sections = splitSections('\n\nNur eine Ueberschrift\n\n   \n\nText');

        expect(sections).toHaveLength(2);
        expect(sections[0].heading).toBe('');
        expect(sections[0].content).toBe('Nur eine Ueberschrift');
        expect(sections[1].content).toBe('Text');
    });

    it('hashes the content so identical sections are recognisable', () => {
        const [first] = splitSections('Gleicher Text');
        const [second] = splitSections('  Gleicher Text  ');

        expect(first.contentHash).toBe(second.contentHash);
        expect(first.contentHash).toMatch(/^[0-9a-f]{64}$/);
    });
});

describe('pasteExternalId', () => {
    it('is stable for the same text and ignores surrounding whitespace', () => {
        expect(pasteExternalId('  Integral  ')).toBe(pasteExternalId('Integral'));
        expect(pasteExternalId('Integral')).toMatch(/^paste:[0-9a-f]{64}$/);
    });

    it('differs for different text', () => {
        expect(pasteExternalId('Integral')).not.toBe(pasteExternalId('Ableitung'));
    });
});
