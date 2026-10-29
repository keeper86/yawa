import { actContentHash, actText } from '@/lib/actScript';
import { resolveConcept } from '@/server/concept/resolve';
import type { Script } from '@/server/templates';
import { evidenceKindSchema, sessionModeSchema, turnRoleSchema } from '@/types/enums';
import { constraintEnumValues } from 'tests/vitest/enumConstraint';
import { getDb, testUsers } from 'tests/vitest/setupTestcontainer';
import { describe, expect, it } from 'vitest';

const owner = testUsers.testUser.user_id;

const script: Script = {
    steps: [
        { role: 'setup', text: 'Gesucht ist das Integral von x^2 ueber [0, 1].' },
        { role: 'model', text: 'Wir zerlegen das Intervall in zwei Trapeze.' },
        { role: 'check', text: 'Berechne den zweiten Trapezterm.' },
    ],
    success: { criterion: 'Der zweite Trapezterm ist korrekt ausgerechnet.' },
};

const createConcept = (title: string) =>
    resolveConcept(getDb(), {
        title,
        language: 'de',
        summary: null,
        wikidataQid: null,
        createdByUserId: owner,
    });

const createAct = async (conceptId: string) => {
    const db = getDb();
    const template = await db('templates').where({ key: 'worked-example', version: 1 }).first();
    if (!template) {
        throw new Error('template missing');
    }
    const title = 'Trapezregel';
    const text = actText({ title, script });
    const [act] = await db('acts')
        .insert({
            concept_id: conceptId,
            template_id: template.id,
            template_version: template.version,
            owner_user_id: owner,
            origin: 'authored',
            status: 'accepted',
            title,
            script,
            script_text: text,
            content_hash: actContentHash(text, template.key, template.version),
        })
        .returning('*');
    return act;
};

const createSession = async (goalConceptId: string, mode: 'study' | 'rehearsal' = 'study') => {
    const db = getDb();
    const lectureId =
        mode === 'rehearsal'
            ? (
                  await db('lectures')
                      .insert({ owner_user_id: owner, title: 'Probelauf', language: 'de' })
                      .returning('id')
              )[0].id
            : null;
    const [session] = await db('tutor_sessions')
        .insert({ user_id: owner, goal_concept_id: goalConceptId, mode, lecture_id: lectureId })
        .returning('*');
    return session;
};

const addTurn = async (
    sessionId: string,
    seq: number,
    options: { actId: string | null; outcome: number | null; role?: 'agent' | 'learner' },
) => {
    const [turn] = await getDb()('turns')
        .insert({
            session_id: sessionId,
            seq,
            role: options.role ?? 'agent',
            act_id: options.actId,
            content: { text: 'Schritt' },
            outcome: options.outcome,
        })
        .returning('*');
    return turn;
};

describe('learner schema', () => {
    it('keeps the learner enums in sync with the check constraints', async () => {
        expect(await constraintEnumValues('tutor_sessions', 'mode')).toEqual([...sessionModeSchema.options].sort());
        expect(await constraintEnumValues('turns', 'role')).toEqual([...turnRoleSchema.options].sort());
        expect(await constraintEnumValues('learner_evidence', 'kind')).toEqual([...evidenceKindSchema.options].sort());
    });

    it('starts a learner at maximum uncertainty', async () => {
        const concept = await createConcept('Startzustand');
        const [state] = await getDb()('learner_concept_state')
            .insert({ user_id: owner, concept_id: concept.id })
            .returning('*');

        expect(state.mastery).toBeCloseTo(0.5);
        expect(state.confidence).toBe(0);
        expect(state.evidence_count).toBe(0);
        expect(state.last_evidence_at).toBeNull();
    });

    it('refuses a mastery outside zero to one', async () => {
        const concept = await createConcept('Grenzwert');
        await expect(
            getDb()('learner_concept_state').insert({ user_id: owner, concept_id: concept.id, mastery: 1.4 }),
        ).rejects.toMatchObject({ code: '23514' });
    });

    it('refuses a rehearsal session without a lecture', async () => {
        const concept = await createConcept('Probelauf ohne Vorlesung');
        await expect(
            getDb()('tutor_sessions').insert({ user_id: owner, goal_concept_id: concept.id, mode: 'rehearsal' }),
        ).rejects.toMatchObject({ code: '23514' });
    });

    it('refuses two turns with the same sequence number', async () => {
        const concept = await createConcept('Sequenz');
        const session = await createSession(concept.id);
        await addTurn(session.id, 1, { actId: null, outcome: null });

        await expect(addTurn(session.id, 1, { actId: null, outcome: null })).rejects.toMatchObject({ code: '23505' });
    });

    it('keeps the transcript when the act is deleted', async () => {
        const concept = await createConcept('Transkript');
        const act = await createAct(concept.id);
        const session = await createSession(concept.id);
        const turn = await addTurn(session.id, 1, { actId: act.id, outcome: 0.8 });

        await getDb()('acts').where({ id: act.id }).del();

        const stored = await getDb()('turns').where({ id: turn.id }).first();
        expect(stored).toBeDefined();
        expect(stored?.act_id).toBeNull();
        expect(stored?.outcome).toBeCloseTo(0.8);
    });

    it('drops turns and evidence with the session', async () => {
        const concept = await createConcept('Kaskade');
        const session = await createSession(concept.id);
        const turn = await addTurn(session.id, 1, { actId: null, outcome: 0.5 });
        await getDb()('learner_evidence').insert({
            user_id: owner,
            concept_id: concept.id,
            turn_id: turn.id,
            kind: 'answer',
            outcome: 0.5,
        });

        await getDb()('tutor_sessions').where({ id: session.id }).del();

        expect(await getDb()('turns').where({ session_id: session.id })).toHaveLength(0);
        expect(await getDb()('learner_evidence').where({ turn_id: turn.id })).toHaveLength(0);
    });

    it('refuses evidence without an existing turn', async () => {
        const concept = await createConcept('Evidenz ohne Turn');
        await expect(
            getDb()('learner_evidence').insert({
                user_id: owner,
                concept_id: concept.id,
                turn_id: crypto.randomUUID(),
                kind: 'answer',
                outcome: 0.5,
            }),
        ).rejects.toMatchObject({ code: '23503' });
    });

    it('summarises how an act performed', async () => {
        const concept = await createConcept('Qualitaet');
        const act = await createAct(concept.id);
        const first = await createSession(concept.id);
        const second = await createSession(concept.id);
        await addTurn(first.id, 1, { actId: act.id, outcome: 1 });
        await addTurn(second.id, 1, { actId: act.id, outcome: 0 });

        const row = await getDb()('act_template_quality').where({ concept_id: concept.id }).first();

        expect(row?.template_key).toBe('worked-example');
        expect(Number(row?.uses)).toBe(2);
        expect(Number(row?.mean_outcome)).toBeCloseTo(0.5);
        expect(Number(row?.sessions)).toBe(2);
    });

    it('reports an act that never ran as unused instead of zero quality', async () => {
        const concept = await createConcept('Ungenutzt');
        await createAct(concept.id);

        const row = await getDb()('act_template_quality').where({ concept_id: concept.id }).first();

        expect(Number(row?.uses)).toBe(0);
        expect(row?.mean_outcome).toBeNull();
    });
});
