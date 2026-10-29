import { describe, expect, it } from 'vitest';
import { actContentHash, actText } from './actScript';

const script = {
    steps: [
        { role: 'setup', text: 'Aufgabe: Integral von x^2 auf [0, 1].' },
        { role: 'model', text: 'Zerlege das Intervall in zwei Trapeze.' },
        { role: 'check', text: 'Rechne den zweiten Trapezterm.' },
    ],
};

describe('actText', () => {
    it('joins the title and the step texts in order', () => {
        expect(actText({ title: 'Trapezregel', script })).toBe(
            'Trapezregel\nAufgabe: Integral von x^2 auf [0, 1].\nZerlege das Intervall in zwei Trapeze.\nRechne den zweiten Trapezterm.',
        );
    });

    it('ignores roles, which are not part of the embedded text', () => {
        const reordered = {
            steps: script.steps.map((step) => ({ ...step, role: 'observe' })),
        };
        expect(actText({ title: 'Trapezregel', script: reordered })).toBe(actText({ title: 'Trapezregel', script }));
    });

    it('ignores surrounding whitespace', () => {
        expect(actText({ title: '  Trapezregel ', script: { steps: [{ text: ' Schritt \n' }] } })).toBe(
            'Trapezregel\nSchritt',
        );
    });
});

describe('actContentHash', () => {
    const text = actText({ title: 'Trapezregel', script });

    it('is a stable sha256 hex digest', () => {
        expect(actContentHash(text, 'worked-example', 1)).toBe(actContentHash(text, 'worked-example', 1));
        expect(actContentHash(text, 'worked-example', 1)).toMatch(/^[0-9a-f]{64}$/);
    });

    it('changes when the text, the template or the version changes', () => {
        const base = actContentHash(text, 'worked-example', 1);

        expect(actContentHash(`${text}\nmehr`, 'worked-example', 1)).not.toBe(base);
        expect(actContentHash(text, 'self-explanation', 1)).not.toBe(base);
        expect(actContentHash(text, 'worked-example', 2)).not.toBe(base);
    });
});
