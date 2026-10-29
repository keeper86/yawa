import { randomUUID } from 'node:crypto';
import { actContentHash, actText } from '@/lib/actScript';
import { createFakeProvider } from '@/server/ai/fake';
import { resolveConcept } from '@/server/concept/resolve';
import type { Script } from '@/server/templates';
import { getDb, testUsers } from 'tests/vitest/setupTestcontainer';
import { describe, expect, it } from 'vitest';
import type { Bead } from '@/lib/lesson';
import { planLesson, repairBead } from './perform';

const learner = testUsers.testUser.user_id;

const script: Script = {
    steps: [
        { role: 'setup', text: 'Gesucht ist das Integral von x^2 ueber [0, 2].' },
        { role: 'model', text: 'Mit N=2 ist Delta x = 1 und die Stuetzstellen sind 0, 1, 2.' },
        { role: 'model', text: 'Die Trapezformel ergibt 1 * (0/2 + 1 + 4/2) = 3.' },
        { role: 'check', text: 'Berechne daraus den Naeherungswert.' },
    ],
    success: { criterion: 'Delta x = 2, Stuetzstellen 0, 2, 4, Wert 24.' },
};

const diagnosis = {
    mastery: 0.4,
    confidence: 0.5,
    evidenceCount: 2,
    lastSeenDaysAgo: 3,
    misconception: true,
};

const prepare = async () => {
    const db = getDb();
    const concept = await resolveConcept(db, {
        title: `Trapezfehler ${randomUUID().slice(0, 6)}`,
        language: 'de',
        summary: 'Fehlerordnung der Trapezregel',
        wikidataQid: null,
        createdByUserId: learner,
    });
    const template = await db('templates').where({ key: 'worked-example', version: 1 }).first();
    if (!template) {
        throw new Error('template missing');
    }
    const text = actText({ title: 'Trapezregel', script });
    const [act] = await db('acts')
        .insert({
            concept_id: concept.id,
            template_id: template.id,
            template_version: template.version,
            owner_user_id: learner,
            origin: 'authored',
            status: 'accepted',
            published_at: new Date(),
            title: 'Trapezregel',
            script,
            script_text: text,
            content_hash: actContentHash(text, template.key, template.version),
        })
        .returning('*');
    return {
        act: { id: act.id, title: act.title, script },
        concept: { title: concept.title, summary: concept.summary, language: concept.language },
    };
};

const lesson = {
    beads: [
        {
            kind: 'choice',
            idea: 'Der Fehler der Trapezregel haengt ueber eine feste Potenz von h ab.',
            question: 'Was passiert mit C·h^2, wenn du h halbierst?',
            figure: null,
            options: [
                { text: 'Er halbiert sich.', correct: false, why: 'Verwechselt h mit h^2.' },
                { text: 'Er viertelt sich.', correct: true, why: '' },
                { text: 'Er bleibt gleich.', correct: false, why: 'Haelt den Fehler fuer unabhaengig von h.' },
            ],
        },
        {
            kind: 'choice',
            idea: 'Die Ordnung ist die Hochzahl im fuehrenden Fehlerterm.',
            question: 'Welche Ordnung hat D·h^4?',
            figure: null,
            options: [
                { text: 'Ordnung 2.', correct: false, why: 'Liest die Zahl der Stuetzstellen statt der Hochzahl.' },
                { text: 'Ordnung 4.', correct: true, why: '' },
                { text: 'Ordnung 16.', correct: false, why: 'Quadriert die Hochzahl.' },
            ],
        },
    ],
};

describe('planLesson', () => {
    it('returns the bead chain the model planned', async () => {
        const input = await prepare();
        const ai = createFakeProvider({ structured: () => lesson });

        const planned = await planLesson(ai, { ...input, diagnosis });

        expect(planned.beads).toEqual(lesson.beads);
    });

    it('sends the act notes, the language and the learner state to the model', async () => {
        const input = await prepare();
        const ai = createFakeProvider({ structured: () => lesson });

        await planLesson(ai, { ...input, diagnosis });

        const prompt = ai.calls[0].map((message) => message.content).join('\n');
        expect(prompt).toContain('mastery 0.40');
        expect(prompt).toContain(`[check] ${script.steps[3].text}`);
        expect(prompt).toContain('repeated mistakes: yes');
        expect(prompt).toContain('anchor');
        expect(prompt).toContain('contrast');
        expect(prompt).toContain(input.concept.language);
    });

    it('rejects a bead with two correct options and falls back to the act', async () => {
        const input = await prepare();
        const doubled = {
            beads: [
                {
                    kind: 'choice',
                    idea: 'Zwei richtige Optionen sind kein Check.',
                    question: 'Was ist 1 + 1?',
                    figure: null,
                    options: [
                        { text: '2', correct: true, why: '' },
                        { text: 'Zwei', correct: true, why: '' },
                        { text: '3', correct: false, why: 'Falsch gezaehlt.' },
                    ],
                },
            ],
        };
        const ai = createFakeProvider({ structured: () => doubled });

        const planned = await planLesson(ai, { ...input, diagnosis });

        expect(planned.beads).toHaveLength(1);
        expect(planned.beads[0].kind).toBe('open');
        expect(planned.beads[0].kind === 'open' && planned.beads[0].expects).toBe(script.success.criterion);
    });

    it('rejects a wrong option without a reason and falls back to the act', async () => {
        const input = await prepare();
        const sloppy = {
            beads: [
                {
                    kind: 'choice',
                    idea: 'Ohne Begruendung weiss der Tutor nicht, was schiefging.',
                    question: 'Was ist 1 + 1?',
                    figure: null,
                    options: [
                        { text: '2', correct: true, why: '' },
                        { text: '3', correct: false, why: '' },
                        { text: '4', correct: false, why: '' },
                    ],
                },
            ],
        };
        const ai = createFakeProvider({ structured: () => sloppy });

        const planned = await planLesson(ai, { ...input, diagnosis });

        expect(planned.beads[0].kind).toBe('open');
    });

    it('never lets a provider failure interrupt the lesson', async () => {
        const input = await prepare();
        const ai = createFakeProvider({
            structured: () => {
                throw new Error('provider down');
            },
        });

        const planned = await planLesson(ai, { ...input, diagnosis });

        expect(planned.beads.length).toBeGreaterThan(0);
        expect(planned.beads[0].question).toBe(script.steps[3].text);
    });
});

describe('repairBead', () => {
    const bead = lesson.beads[0] as Bead;

    it('returns the repair the model wrote', async () => {
        const ai = createFakeProvider({ structured: () => ({ text: 'Du hast h mit h^2 verwechselt.' }) });

        const text = await repairBead(ai, {
            bead,
            chosen: { text: 'Er halbiert sich.', why: 'Verwechselt h mit h^2.' },
            attempt: 1,
        });

        expect(text).toBe('Du hast h mit h^2 verwechselt.');
    });

    it('falls back to the misconception when the model fails', async () => {
        const ai = createFakeProvider({
            structured: () => {
                throw new Error('provider down');
            },
        });

        const text = await repairBead(ai, {
            bead,
            chosen: { text: 'Er halbiert sich.', why: 'Verwechselt h mit h^2.' },
            attempt: 1,
        });

        expect(text).toBe('Verwechselt h mit h^2.');
    });
});

describe('planLesson figures', () => {
    const figure = {
        kind: 'line',
        xLabel: 'Schrittweite h',
        yLabel: 'Fehler',
        caption: 'Halbieren von h viertelt den Fehler.',
        series: [
            {
                label: 'Trapez',
                points: [
                    { x: 0.4, y: 0.08 },
                    { x: 0.2, y: 0.02 },
                    { x: 0.1, y: 0.005 },
                ],
            },
        ],
    };

    it('keeps a figure the model attached to a bead', async () => {
        const input = await prepare();
        const withFigure = {
            beads: [
                {
                    kind: 'choice',
                    idea: 'Vergleiche die Fehler bei halbierter Schrittweite.',
                    question: 'Was zeigen die beiden Punkte?',
                    figure,
                    options: [
                        { text: 'Der Fehler viertelt sich.', correct: true, why: '' },
                        { text: 'Der Fehler halbiert sich.', correct: false, why: 'Verwechselt h mit h^2.' },
                        { text: 'Der Fehler bleibt gleich.', correct: false, why: 'Ignoriert die Zahlen.' },
                    ],
                },
            ],
        };
        const ai = createFakeProvider({ structured: () => withFigure });

        const planned = await planLesson(ai, { ...input, diagnosis });

        expect(planned.beads[0].figure).toEqual(figure);
    });

    it('drops a figure with a repeated x value but keeps the bead', async () => {
        const input = await prepare();
        const broken = {
            beads: [
                {
                    kind: 'choice',
                    idea: 'Zwei Punkte auf demselben x sind keine Kurve.',
                    question: 'Was zeigen die beiden Punkte?',
                    figure: {
                        ...figure,
                        series: [
                            {
                                label: 'Trapez',
                                points: [
                                    { x: 0.2, y: 0.02 },
                                    { x: 0.2, y: 0.01 },
                                ],
                            },
                        ],
                    },
                    options: [
                        { text: 'Der Fehler viertelt sich.', correct: true, why: '' },
                        { text: 'Der Fehler halbiert sich.', correct: false, why: 'Verwechselt h mit h^2.' },
                        { text: 'Der Fehler bleibt gleich.', correct: false, why: 'Ignoriert die Zahlen.' },
                    ],
                },
            ],
        };
        const ai = createFakeProvider({ structured: () => broken });

        const planned = await planLesson(ai, { ...input, diagnosis });

        expect(planned.beads).toHaveLength(1);
        expect(planned.beads[0].figure).toBeNull();
    });
});
