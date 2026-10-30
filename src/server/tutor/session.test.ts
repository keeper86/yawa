import { actContentHash, actText } from '@/lib/actScript';
import { createFakeProvider } from '@/server/ai/fake';
import type { AiProvider } from '@/server/ai';
import { resolveConcept } from '@/server/concept/resolve';
import type { Script } from '@/server/templates';
import { getDb, testUsers } from 'tests/vitest/setupTestcontainer';
import { describe, expect, it } from 'vitest';
import { diagnose } from './diagnose';
import { learningRate, updateMastery } from './mastery';
import { answerBead, closeSession, nextAct, startSession } from './session';

const learner = testUsers.testUser.user_id;
const QUERY = 'Warum stimmt meine Simpson-Naeherung nicht?';

const embedding = (basis: number) => Array.from({ length: 768 }, (_, index) => (index === basis ? 1 : 0));

const script: Script = {
    steps: [
        { role: 'setup', text: 'Gesucht ist das Integral von x^2 ueber [0, 2].' },
        { role: 'model', text: 'Mit N=2 ist Delta x = 1 und die Stuetzstellen sind 0, 1, 2.' },
        { role: 'check', text: 'Berechne den Naeherungswert mit der Trapezformel.' },
    ],
    success: { criterion: 'Der Naeherungswert 3 ist berechnet und begruendet.' },
};

const ai = (score = 0.9): AiProvider =>
    createFakeProvider({
        embeddingDim: 768,
        embeddings: new Map([[QUERY, embedding(0)]]),
        structured: () => ({ score, substantive: true, reason: 'Die Antwort nennt den Wert und den Weg.' }),
    });

const setupAct = async () => {
    const db = getDb();
    const concept = await resolveConcept(db, {
        title: `Trapezregel ${crypto.randomUUID().slice(0, 6)}`,
        language: 'de',
        summary: null,
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

    await db.raw('UPDATE acts SET embedding = ?::vector WHERE id = ?', [`[${embedding(0).join(',')}]`, act.id]);

    return { concept, act };
};

const createLecture = async () => {
    const [lecture] = await getDb()('lectures')
        .insert({ owner_user_id: learner, title: 'Probelauf', language: 'de' })
        .returning('*');
    return lecture;
};

describe('mastery', () => {
    it('never moves further than the maximum step in one outcome', () => {
        const updated = updateMastery({ mastery: 0.5, confidence: 0, evidenceCount: 0 }, 1);

        expect(updated.mastery - 0.5).toBeLessThanOrEqual(0.4);
        expect(updated.mastery).toBeGreaterThan(0.5);
    });

    it('converges without overshooting when outcomes repeat', () => {
        let state = { mastery: 0.5, confidence: 0, evidenceCount: 0 };
        for (let index = 0; index < 20; index += 1) {
            state = updateMastery(state, 1);
        }

        expect(state.mastery).toBeLessThanOrEqual(0.98);
        expect(state.mastery).toBeGreaterThan(0.9);
        expect(state.evidenceCount).toBe(20);
    });

    it('shrinks the step as evidence accumulates', () => {
        expect(learningRate(1)).toBeGreaterThan(learningRate(10));
        expect(learningRate(100)).toBeGreaterThanOrEqual(0.08);
    });

    it('raises confidence with evidence and independent of the outcome', () => {
        const good = updateMastery({ mastery: 0.5, confidence: 0, evidenceCount: 2 }, 1);
        const bad = updateMastery({ mastery: 0.5, confidence: 0, evidenceCount: 2 }, 0);

        expect(good.confidence).toBeCloseTo(bad.confidence);
        expect(good.confidence).toBeGreaterThan(0);
    });
});

describe('diagnose', () => {
    it('reports a misconception after two weak outcomes', async () => {
        const { concept } = await setupAct();
        const session = await startSession(getDb(), {
            userId: learner,
            goalConceptId: concept.id,
            mode: 'study',
            lectureId: null,
        });
        const miss = (score: number, answer: string) =>
            answerBead(getDb(), ai(score), { sessionId: session.id, userId: learner, beadIndex: 0, open: { answer } });

        await nextAct(getDb(), ai(0.2), { sessionId: session.id, userId: learner, query: QUERY });
        await miss(0.2, 'weiss nicht');
        await miss(0.2, 'weiss nicht');
        await nextAct(getDb(), ai(0.2), { sessionId: session.id, userId: learner, query: QUERY });
        await miss(0.3, 'immer noch nicht');
        await miss(0.3, 'immer noch nicht');

        const diagnosis = await diagnose(getDb(), learner, concept.id);

        expect(diagnosis.misconception).toBe(true);
        expect(diagnosis.evidenceCount).toBe(2);
        expect(diagnosis.mastery).toBeLessThan(0.5);
    });

    it('starts a learner at maximum uncertainty', async () => {
        const { concept } = await setupAct();

        const diagnosis = await diagnose(getDb(), learner, concept.id);

        expect(diagnosis.mastery).toBeCloseTo(0.5);
        expect(diagnosis.confidence).toBe(0);
        expect(diagnosis.lastSeenDaysAgo).toBeNull();
    });
});

describe('session loop', () => {
    it('presents an act and records why it was chosen', async () => {
        const { concept } = await setupAct();
        const session = await startSession(getDb(), {
            userId: learner,
            goalConceptId: concept.id,
            mode: 'study',
            lectureId: null,
        });

        const turn = await nextAct(getDb(), ai(), { sessionId: session.id, userId: learner, query: QUERY });

        expect(turn.title).toBe('Trapezregel');
        const stored = await getDb()('turns').where({ id: turn.turnId }).first();
        expect(stored?.role).toBe('agent');
        expect(stored?.act_id).toBe(turn.actId);
        const retrieval = stored?.retrieval as { chosen: string; snapshot: { query: string } };
        expect(retrieval.chosen).toBe(turn.actId);
        expect(retrieval.snapshot.query).toBe(QUERY);
    });

    it('writes evidence and moves mastery in study mode', async () => {
        const { concept } = await setupAct();
        const session = await startSession(getDb(), {
            userId: learner,
            goalConceptId: concept.id,
            mode: 'study',
            lectureId: null,
        });
        await nextAct(getDb(), ai(), { sessionId: session.id, userId: learner, query: QUERY });

        const result = await answerBead(getDb(), ai(1), {
            sessionId: session.id,
            userId: learner,
            beadIndex: 0,
            open: { answer: '3, weil 1*(0+1+2)' },
        });

        expect(result.verdict).toBe('correct');
        expect(result.mastery).toBeGreaterThan(0.5);
        const state = await getDb()('learner_concept_state')
            .where({ user_id: learner, concept_id: concept.id })
            .first();
        expect(state?.evidence_count).toBe(1);
        const evidence = await getDb()('learner_evidence').where({ concept_id: concept.id });
        expect(evidence).toHaveLength(1);
        expect(evidence[0].kind).toBe('answer');
    });

    const twoBeads = {
        beads: [
            {
                kind: 'choice',
                idea: 'Der Fehler der Trapezregel haengt von h mit einer festen Potenz ab.',
                question: 'Was passiert mit C·h^2, wenn du h halbierst?',
                figure: null,
                options: [
                    { text: 'Der Fehler halbiert sich.', correct: false, why: 'Verwechselt h mit h^2.' },
                    { text: 'Der Fehler viertelt sich.', correct: true, why: '' },
                    {
                        text: 'Der Fehler bleibt gleich.',
                        correct: false,
                        why: 'Haelt den Fehler fuer unabhaengig von h.',
                    },
                ],
            },
            {
                kind: 'choice',
                idea: 'Die Ordnung ist die Hochzahl im fuehrenden Fehlerterm.',
                question: 'Welche Ordnung hat eine Methode mit Fehler D·h^4?',
                figure: null,
                options: [
                    { text: 'Ordnung 2.', correct: false, why: 'Liest die Zahl der Stuetzstellen statt der Hochzahl.' },
                    { text: 'Ordnung 4.', correct: true, why: '' },
                    { text: 'Ordnung 16.', correct: false, why: 'Quadriert die Hochzahl.' },
                ],
            },
        ],
    };

    const tutor = (lesson: unknown): AiProvider =>
        createFakeProvider({
            embeddingDim: 768,
            embeddings: new Map([[QUERY, embedding(0)]]),
            structured: (messages) => {
                const system = messages[0].content;
                if (system.includes('short interactive lesson')) {
                    return lesson;
                }
                if (system.includes('picked a wrong option')) {
                    return { text: 'Du hast h mit h^2 verwechselt. Setze h/2 in die Potenz ein.' };
                }
                return { score: 0.9, substantive: true, reason: 'stimmt' };
            },
        });

    const studySession = async () => {
        const { concept: goal } = await setupAct();
        const session = await startSession(getDb(), {
            userId: learner,
            goalConceptId: goal.id,
            mode: 'study',
            lectureId: null,
        });
        const turn = await nextAct(getDb(), tutor(twoBeads), { sessionId: session.id, userId: learner, query: QUERY });
        return { goal, session, turn };
    };

    it('serves a second turn for the same act from the cache', async () => {
        const { concept: goal } = await setupAct();
        const session = await startSession(getDb(), {
            userId: learner,
            goalConceptId: goal.id,
            mode: 'study',
            lectureId: null,
        });
        const first = await nextAct(getDb(), tutor(twoBeads), { sessionId: session.id, userId: learner, query: QUERY });

        let planCalls = 0;
        const counting: AiProvider = createFakeProvider({
            embeddingDim: 768,
            embeddings: new Map([[QUERY, embedding(0)]]),
            structured: (messages) => {
                if (messages[0].content.includes('short interactive lesson')) {
                    planCalls += 1;
                    return twoBeads;
                }
                return { score: 0.9, substantive: true, reason: 'stimmt' };
            },
        });
        const second = await nextAct(getDb(), counting, { sessionId: session.id, userId: learner, query: QUERY });

        expect(second.beads).toEqual(first.beads);
        expect(planCalls).toBe(0);
    });

    it('plans again for a learner who moved into another mastery bucket', async () => {
        const { concept: goal } = await setupAct();
        const session = await startSession(getDb(), {
            userId: learner,
            goalConceptId: goal.id,
            mode: 'study',
            lectureId: null,
        });
        await nextAct(getDb(), tutor(twoBeads), { sessionId: session.id, userId: learner, query: QUERY });

        await getDb()('learner_concept_state')
            .insert({ user_id: learner, concept_id: goal.id, mastery: 0.9, confidence: 0.9, evidence_count: 5 })
            .onConflict(['user_id', 'concept_id'])
            .merge({ mastery: 0.9, confidence: 0.9, evidence_count: 5, updated_at: new Date() });

        let planCalls = 0;
        const counting: AiProvider = createFakeProvider({
            embeddingDim: 768,
            embeddings: new Map([[QUERY, embedding(0)]]),
            structured: (messages) => {
                if (messages[0].content.includes('short interactive lesson')) {
                    planCalls += 1;
                    return twoBeads;
                }
                return { score: 0.9, substantive: true, reason: 'stimmt' };
            },
        });
        await nextAct(getDb(), counting, { sessionId: session.id, userId: learner, query: QUERY });

        expect(planCalls).toBe(1);
    });

    it('does not cache the fallback lesson', async () => {
        const { concept: goal } = await setupAct();
        const session = await startSession(getDb(), {
            userId: learner,
            goalConceptId: goal.id,
            mode: 'study',
            lectureId: null,
        });
        const fallback = await nextAct(getDb(), ai(), { sessionId: session.id, userId: learner, query: QUERY });

        const stored = await getDb()('act_lessons').where({ act_id: fallback.actId });

        expect(fallback.beads).toHaveLength(1);
        expect(stored).toHaveLength(0);
    });

    it('presents the act as one open step when the model cannot plan', async () => {
        const { concept: goal } = await setupAct();
        const session = await startSession(getDb(), {
            userId: learner,
            goalConceptId: goal.id,
            mode: 'study',
            lectureId: null,
        });

        const turn = await nextAct(getDb(), ai(), { sessionId: session.id, userId: learner, query: QUERY });

        expect(turn.beads).toHaveLength(1);
        const bead = turn.beads[0];
        expect(bead.kind).toBe('open');
        expect(bead.kind === 'open' && bead.question).toBe(script.steps[2].text);
        expect(bead.kind === 'open' && bead.expects).toBe(script.success.criterion);
    });

    it('stores the planned beads on the turn', async () => {
        const { turn } = await studySession();

        expect(turn.beads).toEqual(twoBeads.beads);
        const stored = await getDb()('turns').where({ id: turn.turnId }).first();
        expect((stored?.content as { beads: unknown[] }).beads).toHaveLength(2);
    });

    it('repairs a wrong option and only continues on the second attempt', async () => {
        const { goal, session } = await studySession();

        const wrong = await answerBead(getDb(), tutor(twoBeads), {
            sessionId: session.id,
            userId: learner,
            beadIndex: 0,
            choice: { optionIndex: 0 },
        });

        expect(wrong.verdict).toBe('wrong');
        expect(wrong.repair).toContain('verwechselt');
        expect(wrong.nextBeadIndex).toBeNull();
        expect(wrong.done).toBe(false);
        expect(await getDb()('learner_evidence').where({ concept_id: goal.id })).toHaveLength(0);

        const second = await answerBead(getDb(), tutor(twoBeads), {
            sessionId: session.id,
            userId: learner,
            beadIndex: 0,
            choice: { optionIndex: 1 },
        });

        expect(second.verdict).toBe('correct');
        expect(second.nextBeadIndex).toBe(1);
        const evidence = await getDb()('learner_evidence').where({ concept_id: goal.id });
        expect(evidence).toHaveLength(1);
        expect(Number(evidence[0].outcome)).toBeCloseTo(0.6);
    });

    it('reveals the right option after two wrong attempts and goes on', async () => {
        const { goal, session } = await studySession();

        await answerBead(getDb(), tutor(twoBeads), {
            sessionId: session.id,
            userId: learner,
            beadIndex: 0,
            choice: { optionIndex: 0 },
        });
        const second = await answerBead(getDb(), tutor(twoBeads), {
            sessionId: session.id,
            userId: learner,
            beadIndex: 0,
            choice: { optionIndex: 2 },
        });

        expect(second.verdict).toBe('wrong');
        expect(second.repair).toBeNull();
        expect(second.revealOption).toBe(1);
        expect(second.nextBeadIndex).toBe(1);
        const evidence = await getDb()('learner_evidence').where({ concept_id: goal.id });
        expect(Number(evidence[0].outcome)).toBeCloseTo(0.15);
    });

    it('finishes after the last bead', async () => {
        const { session } = await studySession();

        await answerBead(getDb(), tutor(twoBeads), {
            sessionId: session.id,
            userId: learner,
            beadIndex: 0,
            choice: { optionIndex: 1 },
        });
        const last = await answerBead(getDb(), tutor(twoBeads), {
            sessionId: session.id,
            userId: learner,
            beadIndex: 1,
            choice: { optionIndex: 1 },
        });

        expect(last.done).toBe(true);
        expect(last.verdict).toBe('correct');
    });

    it('leaves learner state untouched in a rehearsal', async () => {
        const { concept } = await setupAct();
        const lecture = await createLecture();
        const session = await startSession(getDb(), {
            userId: learner,
            goalConceptId: concept.id,
            mode: 'rehearsal',
            lectureId: lecture.id,
        });
        await nextAct(getDb(), ai(), { sessionId: session.id, userId: learner, query: QUERY });

        const result = await answerBead(getDb(), ai(1), {
            sessionId: session.id,
            userId: learner,
            beadIndex: 0,
            open: { answer: '3' },
        });

        expect(result.mastery).toBeNull();
        expect(await getDb()('learner_evidence').where({ concept_id: concept.id })).toHaveLength(0);
        expect(await getDb()('learner_concept_state').where({ concept_id: concept.id })).toHaveLength(0);
        const graded = await getDb()('turns').where({ session_id: session.id }).whereNotNull('outcome');
        expect(graded).toHaveLength(1);
    });

    it('records a neutral outcome when grading fails', async () => {
        const { concept } = await setupAct();
        const failing: AiProvider = {
            ...ai(),
            chatStructured: async () => {
                throw new Error('Modell nicht erreichbar');
            },
        };
        const session = await startSession(getDb(), {
            userId: learner,
            goalConceptId: concept.id,
            mode: 'study',
            lectureId: null,
        });
        await nextAct(getDb(), ai(), { sessionId: session.id, userId: learner, query: QUERY });

        const result = await answerBead(getDb(), failing, {
            sessionId: session.id,
            userId: learner,
            beadIndex: 0,
            open: { answer: 'keine Ahnung' },
        });

        expect(result.verdict).toBe('wrong');
        expect(result.repair).not.toBeNull();
        expect(result.mastery).toBeNull();
    });

    it('refuses to present an act when the goal concept has none', async () => {
        const concept = await resolveConcept(getDb(), {
            title: `Leer ${crypto.randomUUID().slice(0, 6)}`,
            language: 'de',
            summary: null,
            wikidataQid: null,
            createdByUserId: learner,
        });
        const session = await startSession(getDb(), {
            userId: learner,
            goalConceptId: concept.id,
            mode: 'study',
            lectureId: null,
        });

        await expect(nextAct(getDb(), ai(), { sessionId: session.id, userId: learner, query: QUERY })).rejects.toThrow(
            /No act fits/,
        );
    });

    it('closes a session once and refuses a second start without concepts', async () => {
        const { concept } = await setupAct();
        const session = await startSession(getDb(), {
            userId: learner,
            goalConceptId: concept.id,
            mode: 'study',
            lectureId: null,
        });

        const closed = await closeSession(getDb(), { sessionId: session.id, userId: learner });
        const again = await closeSession(getDb(), { sessionId: session.id, userId: learner });

        expect(closed.closed_at).not.toBeNull();
        expect(again.closed_at).toEqual(closed.closed_at);
    });
});
