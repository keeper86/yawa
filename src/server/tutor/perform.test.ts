import { randomUUID } from 'node:crypto';
import { actContentHash, actText } from '@/lib/actScript';
import { createFakeProvider } from '@/server/ai/fake';
import { resolveConcept } from '@/server/concept/resolve';
import type { Script } from '@/server/templates';
import { getDb, testUsers } from 'tests/vitest/setupTestcontainer';
import { describe, expect, it } from 'vitest';
import { performAct, reactToAnswer } from './perform';

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

describe('performAct', () => {
    it('returns an ask the learner can answer without the tutor notes', async () => {
        const input = await prepare();
        const ai = createFakeProvider({
            structured: () => ({
                moves: [
                    { kind: 'explain', text: 'Du hast ein Integral, das du nicht exakt berechnen kannst.' },
                    {
                        kind: 'ask',
                        question: 'Wie gross ist der Naeherungswert fuer x^2 ueber [0, 4] mit zwei Trapezen?',
                        hint: 'Bestimme zuerst die Schrittweite.',
                        expects: 'Wert 24 mit Schrittweite 2.',
                    },
                ],
            }),
        });

        const moves = await performAct(ai, { ...input, diagnosis });

        const ask = moves[moves.length - 1];
        expect(moves).toHaveLength(2);
        expect(ask.kind).toBe('ask');
        expect(ask.kind === 'ask' && ask.question).toContain('Naeherungswert');
        expect(ask.kind === 'ask' && ask.question).not.toBe(script.steps[3].text);
    });

    it('sends the act notes, the language and the learner state to the model', async () => {
        const input = await prepare();
        const ai = createFakeProvider({
            structured: () => ({ moves: [{ kind: 'ask', question: 'Was ist 3?', hint: '', expects: 'Drei.' }] }),
        });

        await performAct(ai, { ...input, diagnosis });

        const prompt = ai.calls[0].map((message) => message.content).join('\n');
        expect(prompt).toContain('mastery 0.40');
        expect(prompt).toContain(`[check] ${script.steps[3].text}`);
        expect(prompt).toContain('repeated mistakes: yes');
        expect(prompt).toContain(input.concept.language);
    });

    it('falls back to the act when the model returns a broken lesson', async () => {
        const input = await prepare();
        const ai = createFakeProvider({ structured: () => ({ moves: [{ kind: 'explain', text: 'zu kurz' }] }) });

        const moves = await performAct(ai, { ...input, diagnosis });

        const ask = moves[moves.length - 1];
        expect(ask.kind).toBe('ask');
        expect(ask.kind === 'ask' && ask.expects).toBe(script.success.criterion);
    });

    it('never lets a provider failure interrupt the lesson', async () => {
        const input = await prepare();
        const ai = createFakeProvider({
            structured: () => {
                throw new Error('provider down');
            },
        });

        const moves = await performAct(ai, { ...input, diagnosis });

        expect(moves.some((move) => move.kind === 'ask')).toBe(true);
    });
});

describe('reactToAnswer', () => {
    it('repairs a wrong answer with an explanation', async () => {
        const ai = createFakeProvider({
            structured: () => ({
                moves: [
                    {
                        kind: 'feedback',
                        verdict: 'incorrect',
                        text: 'Die Stuetzstellen stimmen, die Schrittweite nicht.',
                    },
                    { kind: 'explain', text: 'Von 0 bis 4 in zwei Teilen ist die Schrittweite 2, nicht 4.' },
                ],
            }),
        });

        const moves = await reactToAnswer(ai, {
            act: { title: 'Trapezregel', script },
            asked: { question: 'Wie gross ist der Naeherungswert?', expects: script.success.criterion },
            answer: 'Delta x = 4, also 32',
            grade: { score: 0.2, reason: 'Schrittweite falsch', substantive: true },
        });

        expect(moves[0].kind).toBe('feedback');
        expect(moves.some((move) => move.kind === 'explain')).toBe(true);
    });

    it('falls back to the grading reason when the model fails', async () => {
        const ai = createFakeProvider({
            structured: () => {
                throw new Error('provider down');
            },
        });

        const moves = await reactToAnswer(ai, {
            act: { title: 'Trapezregel', script },
            asked: { question: 'Wie gross ist der Naeherungswert?', expects: script.success.criterion },
            answer: '24',
            grade: { score: 0.9, reason: 'Wert und Weg stimmen', substantive: true },
        });

        expect(moves).toEqual([{ kind: 'feedback', verdict: 'correct', text: 'Wert und Weg stimmen' }]);
    });
});
