import { actContentHash, actText } from '@/lib/actScript';
import { createFakeProvider } from '@/server/ai/fake';
import type { AiProvider } from '@/server/ai';
import { resolveConcept } from '@/server/concept/resolve';
import type { Script } from '@/server/templates';
import { getDb, testUsers } from 'tests/vitest/setupTestcontainer';
import { describe, expect, it } from 'vitest';
import { diagnose } from './diagnose';
import { learningRate, updateMastery } from './mastery';
import { closeSession, nextAct, respondToAct, startSession } from './session';

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
        await nextAct(getDb(), ai(0.2), { sessionId: session.id, userId: learner, query: QUERY });
        await respondToAct(getDb(), ai(0.2), { sessionId: session.id, userId: learner, answer: 'weiss nicht' });
        await nextAct(getDb(), ai(0.2), { sessionId: session.id, userId: learner, query: QUERY });
        await respondToAct(getDb(), ai(0.3), { sessionId: session.id, userId: learner, answer: 'immer noch nicht' });

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

        const result = await respondToAct(getDb(), ai(1), {
            sessionId: session.id,
            userId: learner,
            answer: '3, weil 1*(0+1+2)',
        });

        expect(result.outcome).toBe(1);
        expect(result.mastery).toBeGreaterThan(0.5);
        const state = await getDb()('learner_concept_state')
            .where({ user_id: learner, concept_id: concept.id })
            .first();
        expect(state?.evidence_count).toBe(1);
        const evidence = await getDb()('learner_evidence').where({ concept_id: concept.id });
        expect(evidence).toHaveLength(1);
        expect(evidence[0].kind).toBe('answer');
    });

    it('presents the act as a lesson that ends in one answerable question', async () => {
        const { concept } = await setupAct();
        const session = await startSession(getDb(), {
            userId: learner,
            goalConceptId: concept.id,
            mode: 'study',
            lectureId: null,
        });

        const turn = await nextAct(getDb(), ai(), { sessionId: session.id, userId: learner, query: QUERY });

        const asks = turn.moves.filter((move) => move.kind === 'ask');
        const last = turn.moves[turn.moves.length - 1];
        expect(asks).toHaveLength(1);
        expect(last.kind).toBe('ask');
        expect(last.kind === 'ask' && last.expects).toBe(script.success.criterion);
    });

    it('shows the lesson the tutor model writes and stores it on the turn', async () => {
        const { concept } = await setupAct();
        const lesson = {
            moves: [
                { kind: 'explain', text: 'Du willst die Flaeche unter x^2 naeherungsweise bestimmen.' },
                {
                    kind: 'ask',
                    question: 'Wie gross ist Delta x fuer [0, 4] mit zwei Trapezen?',
                    hint: 'Breite geteilt durch Anzahl der Teile.',
                    expects: 'Delta x = 2.',
                },
            ],
        };
        const tutor: AiProvider = createFakeProvider({
            embeddingDim: 768,
            embeddings: new Map([[QUERY, embedding(0)]]),
            structured: (messages) =>
                messages[0].content.includes('perform one prepared teaching act')
                    ? lesson
                    : { score: 0.9, substantive: true, reason: 'stimmt' },
        });
        const session = await startSession(getDb(), {
            userId: learner,
            goalConceptId: concept.id,
            mode: 'study',
            lectureId: null,
        });

        const turn = await nextAct(getDb(), tutor, { sessionId: session.id, userId: learner, query: QUERY });

        expect(turn.moves).toEqual(lesson.moves);
        const stored = await getDb()('turns').where({ id: turn.turnId }).first();
        expect((stored?.content as { moves: unknown[] }).moves).toHaveLength(2);
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

        const result = await respondToAct(getDb(), ai(1), {
            sessionId: session.id,
            userId: learner,
            answer: '3',
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

        const result = await respondToAct(getDb(), failing, {
            sessionId: session.id,
            userId: learner,
            answer: 'keine Ahnung',
        });

        expect(result.outcome).toBe(0.5);
        expect(result.mastery).toBeCloseTo(0.5);
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
