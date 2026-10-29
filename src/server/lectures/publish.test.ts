import { actContentHash, actText } from '@/lib/actScript';
import type { LectureBrief } from '@/lib/lectureBrief';
import { resolveConcept } from '@/server/concept/resolve';
import type { Script } from '@/server/templates';
import { getDb, testUsers } from 'tests/vitest/setupTestcontainer';
import { describe, expect, it } from 'vitest';
import { publishLecture } from './publish';

const owner = testUsers.testUser.user_id;

const script: Script = {
    steps: [
        { role: 'setup', text: 'Gesucht ist das Integral von x^2 ueber [0, 1].' },
        { role: 'model', text: 'Wir zerlegen das Intervall in zwei Trapeze.' },
        { role: 'check', text: 'Berechne den zweiten Trapezterm.' },
    ],
    success: { criterion: 'Der zweite Trapezterm ist korrekt ausgerechnet.' },
};

const brief: LectureBrief = {
    audience: 'B.Sc. Physik',
    objectives: [{ concept: 'trapezregel', verb: 'apply', depth: 'zwei Intervalle von Hand' }],
    mustCover: ['trapezregel'],
    mustAvoid: [],
    durationMinutes: 90,
    tone: 'formal',
    language: 'de',
    notes: '',
};

const createConcept = (title: string) =>
    resolveConcept(getDb(), {
        title,
        language: 'de',
        summary: null,
        wikidataQid: null,
        createdByUserId: owner,
    });

const createLecture = async (concepts: { id: string; slug: string }[], overrides: Record<string, unknown> = {}) => {
    const db = getDb();
    const [lecture] = await db('lectures')
        .insert({
            owner_user_id: owner,
            title: 'Numerische Integration',
            language: 'de',
            brief: {
                ...brief,
                objectives: concepts.map((concept) => ({
                    concept: concept.slug,
                    verb: 'apply',
                    depth: 'zwei Intervalle',
                })),
                mustCover: concepts.map((concept) => concept.slug),
            },
            ...overrides,
        })
        .returning('*');
    for (const concept of concepts) {
        await db('lecture_concepts').insert({ lecture_id: lecture.id, concept_id: concept.id });
    }
    return lecture;
};

const addAct = async (
    lectureId: string,
    conceptId: string,
    options: { status: 'proposed' | 'accepted' | 'rejected'; position: number; grounded: boolean },
) => {
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
            origin: 'generated',
            status: options.status,
            title,
            script,
            script_text: text,
            content_hash: actContentHash(text, template.key, template.version),
        })
        .returning('*');

    if (options.grounded) {
        const [source] = await db('sources')
            .insert({
                kind: 'paste',
                external_id: `paste:${crypto.randomUUID()}`,
                title: 'Skript',
                language: 'de',
                license: 'own-work',
                owner_user_id: owner,
            })
            .returning('*');
        const [section] = await db('source_sections')
            .insert({
                source_id: source.id,
                position: 0,
                heading: 'Trapezregel',
                content: 'Die Trapezregel naehert das Integral durch Trapeze an.',
                content_hash: 'hash',
            })
            .returning('*');
        await db('act_grounding').insert({ act_id: act.id, source_section_id: section.id });
    }

    await db('lecture_acts').insert({ lecture_id: lectureId, act_id: act.id, position: options.position });
    return act;
};

describe('publishLecture', () => {
    it('publishes the lecture and its accepted acts', async () => {
        const concept = await createConcept('Trapezregel');
        const lecture = await createLecture([concept]);
        const act = await addAct(lecture.id, concept.id, { status: 'accepted', position: 1, grounded: true });

        const published = await publishLecture(getDb(), { lectureId: lecture.id, userId: owner });

        expect(published.published_at).not.toBeNull();
        const stored = await getDb()('acts').where({ id: act.id }).first();
        expect(stored?.published_at).not.toBeNull();
        expect(stored?.reviewed_by_user_id).toBe(owner);
    });

    it('refuses a lecture with a proposed act and changes nothing', async () => {
        const concept = await createConcept('Trapezregel B');
        const lecture = await createLecture([concept]);
        const act = await addAct(lecture.id, concept.id, { status: 'proposed', position: 1, grounded: true });

        await expect(publishLecture(getDb(), { lectureId: lecture.id, userId: owner })).rejects.toThrow(
            /not publishable/,
        );

        const storedLecture = await getDb()('lectures').where({ id: lecture.id }).first();
        const storedAct = await getDb()('acts').where({ id: act.id }).first();
        expect(storedLecture?.published_at).toBeNull();
        expect(storedAct?.published_at).toBeNull();
    });

    it('refuses a generated act without grounding', async () => {
        const concept = await createConcept('Trapezregel C');
        const lecture = await createLecture([concept]);
        await addAct(lecture.id, concept.id, { status: 'accepted', position: 1, grounded: false });

        await expect(publishLecture(getDb(), { lectureId: lecture.id, userId: owner })).rejects.toThrow(
            /missing grounding/,
        );
    });

    it('refuses a lecture where a mustCover concept has no act', async () => {
        const trapez = await createConcept('Trapezregel D');
        const simpson = await createConcept('Simpsonregel D');
        const lecture = await createLecture([trapez, simpson]);
        await addAct(lecture.id, trapez.id, { status: 'accepted', position: 1, grounded: true });

        await expect(publishLecture(getDb(), { lectureId: lecture.id, userId: owner })).rejects.toThrow(
            /no act covers simpsonregel/,
        );
    });

    it('refuses a brief referring to a concept outside the scope', async () => {
        const concept = await createConcept('Trapezregel E');
        const lecture = await createLecture([concept], {
            brief: { ...brief, mustCover: ['kettenregel'] },
        });
        await addAct(lecture.id, concept.id, { status: 'accepted', position: 1, grounded: true });

        await expect(publishLecture(getDb(), { lectureId: lecture.id, userId: owner })).rejects.toThrow(
            /outside the lecture scope/,
        );
    });

    it('refuses a lecture whose brief is not filled in', async () => {
        const concept = await createConcept('Trapezregel F');
        const lecture = await createLecture([concept], { brief: {} });
        await addAct(lecture.id, concept.id, { status: 'accepted', position: 1, grounded: true });

        await expect(publishLecture(getDb(), { lectureId: lecture.id, userId: owner })).rejects.toThrow();
    });

    it('refuses a lecture without acts', async () => {
        const concept = await createConcept('Trapezregel G');
        const lecture = await createLecture([concept]);

        await expect(publishLecture(getDb(), { lectureId: lecture.id, userId: owner })).rejects.toThrow(/no acts/);
    });

    it('refuses a publisher who does not own the lecture', async () => {
        const concept = await createConcept('Trapezregel H');
        const lecture = await createLecture([concept]);
        await addAct(lecture.id, concept.id, { status: 'accepted', position: 1, grounded: true });

        await expect(
            publishLecture(getDb(), { lectureId: lecture.id, userId: testUsers.otherUser.user_id }),
        ).rejects.toThrow(/owner/);
    });

    it('is idempotent and keeps the first publication time', async () => {
        const concept = await createConcept('Trapezregel I');
        const lecture = await createLecture([concept]);
        await addAct(lecture.id, concept.id, { status: 'accepted', position: 1, grounded: true });

        const first = await publishLecture(getDb(), { lectureId: lecture.id, userId: owner });
        const second = await publishLecture(getDb(), { lectureId: lecture.id, userId: owner });

        expect(second.published_at).toEqual(first.published_at);
    });

    it('leaves the acts alone when the lecture is deleted', async () => {
        const concept = await createConcept('Trapezregel J');
        const lecture = await createLecture([concept]);
        const act = await addAct(lecture.id, concept.id, { status: 'accepted', position: 1, grounded: true });

        await getDb()('lectures').where({ id: lecture.id }).del();

        expect(await getDb()('acts').where({ id: act.id })).toHaveLength(1);
        expect(await getDb()('lecture_acts').where({ lecture_id: lecture.id })).toHaveLength(0);
    });
});
