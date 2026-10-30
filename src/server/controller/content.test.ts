import { actContentHash, actText } from '@/lib/actScript';
import type { Script } from '@/server/templates';
import { getCaller, getDb, getUnauthenticatedCaller, testUsers } from 'tests/vitest/setupTestcontainer';
import { describe, expect, it } from 'vitest';

const owner = testUsers.testUser.user_id;
const other = testUsers.otherUser.user_id;

const script: Script = {
    steps: [
        { role: 'setup', text: 'Gesucht ist das Integral von x^2 ueber [0, 1].' },
        { role: 'model', text: 'Wir zerlegen das Intervall in zwei Trapeze.' },
        { role: 'check', text: 'Berechne den zweiten Trapezterm.' },
    ],
    success: { criterion: 'Der zweite Trapezterm ist korrekt ausgerechnet.' },
};

const domainCode = async (run: () => Promise<unknown>): Promise<string | null> => {
    try {
        await run();
        return null;
    } catch (error) {
        const cause = (error as { cause?: { domainError?: { code: string } } }).cause;
        return cause?.domainError?.code ?? null;
    }
};

const newLecture = async (title: string) => {
    const lecture = await getCaller(owner).lecture.create({ title, language: 'de' });
    return lecture;
};

const validBrief = (slugs: string[]) => ({
    audience: 'B.Sc. Physik',
    objectives: slugs.map((slug) => ({ concept: slug, verb: 'apply' as const, depth: 'zwei Intervalle' })),
    mustCover: slugs,
    mustAvoid: [],
    durationMinutes: 90,
    tone: 'formal' as const,
    language: 'de' as const,
    notes: '',
});

const insertAct = async (options: {
    ownerUserId: string;
    published: boolean;
    conceptId?: string;
    sourceSectionId?: string;
}) => {
    const db = getDb();
    const concept =
        options.conceptId === undefined
            ? await getCaller(owner).concept.resolve({
                  title: `Konzept ${crypto.randomUUID()}`,
                  language: 'de',
                  summary: null,
                  wikidataQid: null,
              })
            : { id: options.conceptId };
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
            owner_user_id: options.ownerUserId,
            origin: options.sourceSectionId ? 'generated' : 'authored',
            status: options.published ? 'accepted' : 'proposed',
            published_at: options.published ? new Date() : null,
            title: 'Trapezregel',
            script,
            script_text: text,
            content_hash: actContentHash(text, template.key, template.version),
        })
        .returning('*');

    if (options.sourceSectionId) {
        await db('act_grounding').insert({ act_id: act.id, source_section_id: options.sourceSectionId });
    }

    return { act, concept };
};

describe('content controllers', () => {
    it('requires a session', async () => {
        await expect(getUnauthenticatedCaller().lecture.create({ title: 'X', language: 'de' })).rejects.toThrow();
    });

    it('creates a lecture and stores a brief that validates', async () => {
        const caller = getCaller(owner);
        const concept = await caller.concept.resolve({
            title: 'Trapezregel',
            language: 'de',
            summary: null,
            wikidataQid: null,
        });
        const lecture = await newLecture('Numerik');
        expect(lecture.briefValid).toBe(false);

        const updated = await caller.lecture.updateBrief({ lectureId: lecture.id, brief: validBrief([concept.slug]) });

        expect(updated.briefValid).toBe(true);
        expect(updated.language).toBe('de');
    });

    it('finds a concept by a title written without umlauts', async () => {
        await getCaller(owner).concept.resolve({
            title: 'Größenordnung',
            language: 'de',
            summary: null,
            wikidataQid: null,
        });

        const found = await getCaller(owner).concept.search({ query: 'grossenordnung', language: 'de', limit: 5 });

        expect(found.map((concept) => concept.title)).toContain('Größenordnung');
    });

    it('reports a cyclic prerequisite as a domain error', async () => {
        const caller = getCaller(owner);
        const first = await caller.concept.resolve({
            title: `Kette ${crypto.randomUUID()}`,
            language: 'de',
            summary: null,
            wikidataQid: null,
        });
        const second = await caller.concept.resolve({
            title: `Kette ${crypto.randomUUID()}`,
            language: 'de',
            summary: null,
            wikidataQid: null,
        });

        await caller.concept.link({ sourceConceptId: first.id, targetConceptId: second.id, type: 'requires' });

        const code = await domainCode(() =>
            caller.concept.link({ sourceConceptId: second.id, targetConceptId: first.id, type: 'requires' }),
        );
        expect(code).toBe('relationCycle');
    });

    it('hides an unpublished act of another user and refuses to review it', async () => {
        const { act } = await insertAct({ ownerUserId: other, published: false });

        const visible = await getCaller(owner).act.list({ conceptId: null, lectureId: null, status: null, limit: 50 });
        expect(visible.map((entry) => entry.id)).not.toContain(act.id);

        const code = await domainCode(() => getCaller(owner).act.review({ actId: act.id, decision: 'accepted' }));
        expect(code).toBe('notOwner');
    });

    it('refuses to delete a source that grounds an act', async () => {
        const caller = getCaller(owner);
        const lecture = await newLecture('Quellen');
        const source = await caller.source.addText({
            lectureId: lecture.id,
            title: 'Skript',
            text: 'Trapezregel\nDie Flaeche wird durch Trapeze genaehert, nicht durch Parabeln.',
            language: 'de',
        });
        const section = await getDb()('source_sections').where({ source_id: source.id }).first();
        if (!section) {
            throw new Error('section missing');
        }
        await insertAct({ ownerUserId: owner, published: false, sourceSectionId: section.id });

        const code = await domainCode(() => caller.source.remove({ sourceId: source.id }));
        expect(code).toBe('sourceInUse');
    });

    it('publishes a lecture end to end', async () => {
        const caller = getCaller(owner);
        const concept = await caller.concept.resolve({
            title: `Publish ${crypto.randomUUID()}`,
            language: 'de',
            summary: null,
            wikidataQid: null,
        });
        const lecture = await newLecture('Veröffentlichung');
        await caller.lecture.updateBrief({ lectureId: lecture.id, brief: validBrief([concept.slug]) });
        await caller.lecture.setScope({ lectureId: lecture.id, conceptIds: [concept.id], sourceIds: [] });

        const source = await caller.source.addText({
            lectureId: lecture.id,
            title: 'Skript',
            text: 'Trapezregel\nDie Flaeche wird durch Trapeze genaehert, nicht durch Parabeln.',
            language: 'de',
        });
        const section = await getDb()('source_sections').where({ source_id: source.id }).first();
        if (!section) {
            throw new Error('section missing');
        }
        const { act } = await insertAct({
            ownerUserId: owner,
            published: false,
            conceptId: concept.id,
            sourceSectionId: section.id,
        });

        await caller.lecture.setActs({ lectureId: lecture.id, actIds: [act.id] });

        const refused = await domainCode(() => caller.lecture.publish({ lectureId: lecture.id }));
        expect(refused).toBe('lectureNotPublishable');

        await caller.act.review({ actId: act.id, decision: 'accepted' });
        const published = await caller.lecture.publish({ lectureId: lecture.id });

        expect(published.publishedAt).not.toBeNull();
        const storedAct = await getDb()('acts').where({ id: act.id }).first();
        expect(storedAct?.published_at).not.toBeNull();
    });

    it('refuses to put a foreign act into a lecture', async () => {
        const { act } = await insertAct({ ownerUserId: other, published: true });
        const lecture = await newLecture('Fremdakte');

        const code = await domainCode(() =>
            getCaller(owner).lecture.setActs({ lectureId: lecture.id, actIds: [act.id] }),
        );
        expect(code).toBe('notOwner');
    });

    it('refuses a change to a published act', async () => {
        const { act } = await insertAct({ ownerUserId: owner, published: true });

        const code = await domainCode(() => getCaller(owner).act.review({ actId: act.id, decision: 'rejected' }));
        expect(code).toBe('publicationRefused');
    });

    it('lists own drafts only and hides other lectures', async () => {
        const draft = await getCaller(owner).lecture.create({
            title: `Entwurf ${crypto.randomUUID()}`,
            language: 'de',
        });

        expect((await getCaller(owner).lecture.list({ limit: 100 })).map((lecture) => lecture.id)).toContain(draft.id);
        expect((await getCaller(other).lecture.list({ limit: 100 })).map((lecture) => lecture.id)).not.toContain(
            draft.id,
        );

        const code = await domainCode(() => getCaller(other).lecture.get({ lectureId: draft.id }));
        expect(code).toBe('lectureNotFound');
    });

    it('returns the scope and the ordered acts of a lecture', async () => {
        const caller = getCaller(owner);
        const concept = await caller.concept.resolve({
            title: `Scope ${crypto.randomUUID()}`,
            language: 'de',
            summary: null,
            wikidataQid: null,
        });
        const lecture = await newLecture('Reihenfolge');
        await caller.lecture.setScope({ lectureId: lecture.id, conceptIds: [concept.id], sourceIds: [] });

        const first = await insertAct({ ownerUserId: owner, published: false });
        const second = await insertAct({ ownerUserId: owner, published: false });
        await caller.lecture.setActs({ lectureId: lecture.id, actIds: [second.act.id, first.act.id] });

        const detail = await caller.lecture.get({ lectureId: lecture.id });

        expect(detail.conceptIds).toEqual([concept.id]);
        expect(detail.actIds).toEqual([second.act.id, first.act.id]);
    });
});
