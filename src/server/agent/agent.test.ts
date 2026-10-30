import { createFakeProvider } from '@/server/ai/fake';
import type { AiProvider, ChatMessage } from '@/server/ai';
import { resolveConcept } from '@/server/concept/resolve';
import { DomainFailure } from '@/server/domainError';
import { getDb, testUsers } from 'tests/vitest/setupTestcontainer';
import { describe, expect, it } from 'vitest';
import { planLecture, runCreationJob } from './jobs';

const owner = testUsers.testUser.user_id;

const script = (title: string) => ({
    title,
    script: {
        steps: [
            { role: 'setup', text: 'Wir betrachten das Integral von x^2 ueber [0, 2].' },
            { role: 'model', text: 'Mit N=2 ist Delta x = 1 und die Stuetzstellen sind 0, 1, 2.' },
            { role: 'check', text: 'Berechne den Naeherungswert mit der Trapezformel.' },
        ],
        success: { criterion: 'Der Naeherungswert 3 ist berechnet und begruendet.' },
    },
});

const agentFake = (plan: unknown): AiProvider & { calls: ChatMessage[][] } =>
    createFakeProvider({
        structured: (messages) =>
            messages[0].content.includes('You plan a lecture')
                ? plan
                : script(`Akt ${crypto.randomUUID().slice(0, 6)}`),
    }) as AiProvider & { calls: ChatMessage[][] };

const setupLecture = async (brief: Record<string, unknown> = {}) => {
    const db = getDb();
    const concept = await resolveConcept(db, {
        title: `Trapezregel ${crypto.randomUUID().slice(0, 6)}`,
        language: 'de',
        summary: null,
        wikidataQid: null,
        createdByUserId: owner,
    });
    const [source] = await db('sources')
        .insert({
            owner_user_id: owner,
            kind: 'paste',
            external_id: `paste:${crypto.randomUUID()}`,
            title: 'Skript',
            language: 'de',
            license: 'own-work',
        })
        .returning('*');
    const [section] = await db('source_sections')
        .insert({
            source_id: source.id,
            position: 0,
            heading: 'Trapezregel',
            content:
                'Die Trapezregel naehert das Integral durch Trapeze an. Mit N=2 ergibt sich die Summe der beiden Trapezflaechen.',
            content_hash: 'hash',
        })
        .returning('*');

    const [lecture] = await db('lectures')
        .insert({
            owner_user_id: owner,
            title: 'Numerik',
            language: 'de',
            brief: {
                audience: 'B.Sc. Physik',
                objectives: [{ concept: concept.slug, verb: 'apply', depth: 'zwei Intervalle' }],
                mustCover: [concept.slug],
                mustAvoid: [],
                durationMinutes: 30,
                tone: 'formal',
                language: 'de',
                notes: '',
                ...brief,
            },
        })
        .returning('*');

    await db('lecture_concepts').insert({ lecture_id: lecture.id, concept_id: concept.id });
    await db('lecture_sources').insert({ lecture_id: lecture.id, source_id: source.id });

    return { lecture, concept, section };
};

const validPlan = (conceptSlug: string, sectionId: string) => ({
    units: [
        {
            conceptSlug,
            templateKey: 'worked-example',
            order: 1,
            rationale: 'Prozedurales Verfahren, novize Lernende.',
            sourceSectionIds: [sectionId],
        },
    ],
    proposedPrerequisites: [],
});

describe('creation agent', () => {
    it('stores a valid plan and generates nothing yet', async () => {
        const { lecture, concept, section } = await setupLecture();
        const job = await planLecture(getDb(), agentFake(validPlan(concept.slug, section.id)), {
            lectureId: lecture.id,
            userId: owner,
        });

        expect(job.status).toBe('plan_ready');
        expect(job.usage).toEqual({ calls: 1, inputTokens: 1, outputTokens: 1, reasoningTokens: 0, totalTokens: 2 });
        const acts = await getDb()('acts').where({ owner_user_id: owner, origin: 'generated' });
        expect(acts).toHaveLength(0);
    });

    it('turns a planned unit into a proposed, grounded act', async () => {
        const { lecture, concept, section } = await setupLecture();
        const ai = agentFake(validPlan(concept.slug, section.id));
        const job = await planLecture(getDb(), ai, { lectureId: lecture.id, userId: owner });

        const result = await runCreationJob(getDb(), ai, { jobId: job.id, userId: owner });

        expect(result).toEqual({ generated: 1, failed: 0 });
        const stored = await getDb()('creation_jobs').where({ id: job.id }).first();
        expect(stored?.usage).toMatchObject({ calls: 1 });
        const acts = await getDb()('acts').where({ owner_user_id: owner, origin: 'generated' });
        expect(acts).toHaveLength(1);
        expect(acts[0].status).toBe('proposed');
        expect(acts[0].published_at).toBeNull();

        const grounding = await getDb()('act_grounding').where({ act_id: acts[0].id });
        expect(grounding).toHaveLength(1);
        expect(grounding[0].source_section_id).toBe(section.id);

        const linked = await getDb()('lecture_acts').where({ lecture_id: lecture.id });
        expect(linked.map((entry) => entry.act_id)).toContain(acts[0].id);
    });

    it('refuses a plan that misses a required concept', async () => {
        const { lecture, concept, section } = await setupLecture();
        const stored = await getDb()('lectures').where({ id: lecture.id }).first();
        await getDb()('lectures')
            .where({ id: lecture.id })
            .update({
                brief: { ...(stored?.brief as Record<string, unknown>), mustCover: [concept.slug, 'kettenregel'] },
            });

        const error = await planLecture(getDb(), agentFake(validPlan(concept.slug, section.id)), {
            lectureId: lecture.id,
            userId: owner,
        }).catch((caught: unknown) => caught);

        expect((error as DomainFailure).domainCode).toBe('planIncomplete');
        expect((error as Error).message).toContain('kettenregel');
        const job = await getDb()('creation_jobs').where({ lecture_id: lecture.id }).first();
        expect(job?.status).toBe('failed');
    });

    it('counts a failing unit and completes the job with an error note', async () => {
        const { lecture, concept, section } = await setupLecture();
        const base = agentFake(validPlan(concept.slug, section.id));
        const failing: AiProvider = {
            ...base,
            chatStructured: async () => {
                throw new DomainFailure('aiInvalidResponse', 'Modell liefert nichts');
            },
        };
        const job = await planLecture(getDb(), base, { lectureId: lecture.id, userId: owner });

        const result = await runCreationJob(getDb(), failing, { jobId: job.id, userId: owner });

        expect(result).toEqual({ generated: 0, failed: 1 });
        const stored = await getDb()('creation_jobs').where({ id: job.id }).first();
        expect(stored?.status).toBe('failed');
        expect(stored?.error).toContain('Modell liefert nichts');
    });

    it('refuses a second job while one is active', async () => {
        const { lecture, concept, section } = await setupLecture();
        const ai = agentFake(validPlan(concept.slug, section.id));
        await planLecture(getDb(), ai, { lectureId: lecture.id, userId: owner });

        const error = await planLecture(getDb(), ai, { lectureId: lecture.id, userId: owner }).catch(
            (caught: unknown) => caught,
        );

        expect((error as DomainFailure).domainCode).toBe('creationJobActive');
    });

    it('refuses to plan without a brief', async () => {
        const { lecture } = await setupLecture({ audience: '' });

        const error = await planLecture(getDb(), agentFake({ units: [], proposedPrerequisites: [] }), {
            lectureId: lecture.id,
            userId: owner,
        }).catch((caught: unknown) => caught);

        expect((error as DomainFailure).domainCode).toBe('invalidBrief');
    });

    it('refuses a foreign lecture', async () => {
        const { lecture } = await setupLecture();

        const error = await planLecture(getDb(), agentFake({ units: [], proposedPrerequisites: [] }), {
            lectureId: lecture.id,
            userId: testUsers.otherUser.user_id,
        }).catch((caught: unknown) => caught);

        expect((error as DomainFailure).domainCode).toBe('notOwner');
    });
});
