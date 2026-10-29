import { describe, expect, it } from 'vitest';
import { briefSchema, type LectureBrief, validateBriefScope } from './lectureBrief';

const brief: LectureBrief = {
    audience: 'B.Sc. Physik, 3. Semester',
    objectives: [{ concept: 'trapezregel', verb: 'apply', depth: 'ein zweistufiges Integral von Hand rechnen' }],
    mustCover: ['trapezregel', 'simpsonregel'],
    mustAvoid: ['adaptive Schrittweite'],
    durationMinutes: 90,
    tone: 'formal',
    language: 'de',
    notes: 'Riemannsummen sind bekannt, Interpolation nicht.',
};

const scope = ['trapezregel', 'simpsonregel', 'riemannsumme'];

describe('briefSchema', () => {
    it('accepts a complete brief', () => {
        expect(briefSchema.safeParse(brief).success).toBe(true);
    });

    it('rejects a verb that cannot be reviewed', () => {
        const vague = { ...brief, objectives: [{ ...brief.objectives[0], verb: 'understand' }] };
        expect(briefSchema.safeParse(vague).success).toBe(false);
    });

    it('rejects a missing mustCover list', () => {
        const { mustCover: _mustCover, ...without } = brief;
        expect(briefSchema.safeParse(without).success).toBe(false);
    });

    it('rejects a duration outside a plausible lecture', () => {
        expect(briefSchema.safeParse({ ...brief, durationMinutes: 5 }).success).toBe(false);
        expect(briefSchema.safeParse({ ...brief, durationMinutes: 900 }).success).toBe(false);
    });

    it('rejects an empty objective list', () => {
        expect(briefSchema.safeParse({ ...brief, objectives: [] }).success).toBe(false);
    });
});

describe('validateBriefScope', () => {
    it('accepts a brief whose concepts are all in scope', () => {
        expect(() => validateBriefScope(brief, scope)).not.toThrow();
    });

    it('reports an objective concept that is outside the scope', () => {
        expect(() => validateBriefScope(brief, ['trapezregel'])).toThrow(/simpsonregel/);
    });

    it('reports a mustCover concept that is outside the scope', () => {
        const onlyObjective = { ...brief, mustCover: [] };
        expect(() => validateBriefScope({ ...onlyObjective, mustCover: ['kettenregel'] }, scope)).toThrow(
            /kettenregel/,
        );
    });

    it('names each offending concept once', () => {
        const duplicated = { ...brief, mustCover: ['kettenregel', 'kettenregel'] };
        expect(() => validateBriefScope(duplicated, scope)).toThrow(
            /^Brief references concepts outside the lecture scope: kettenregel$/,
        );
    });
});
