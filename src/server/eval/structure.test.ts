import { createFakeProvider } from '@/server/ai/fake';
import { retrieve } from '@/server/retrieval';
import { getDb, testUsers } from 'tests/vitest/setupTestcontainer';
import { describe, expect, it } from 'vitest';
import { loadCorpus, seedCorpus } from './corpus';

const owner = testUsers.testUser.user_id;
const other = testUsers.otherUser.user_id;

const diagnosis = {
    mastery: 0.3,
    confidence: 0.2,
    evidenceCount: 0,
    lastSeenDaysAgo: null,
    misconception: false,
};

const ai = () => createFakeProvider({ embeddingDim: 768 });

const conceptId = async (slug: string) => {
    const row = await getDb()('concepts').where({ slug }).first();
    if (!row) {
        throw new Error(`concept ${slug} missing`);
    }
    return row.id;
};

const retrieveFor = async (slug: string, query: string) =>
    retrieve(getDb(), ai(), {
        viewerUserId: owner,
        goalConceptId: await conceptId(slug),
        query,
        diagnosis,
    });

describe('golden corpus', () => {
    it('seeds every concept, relation and act exactly once', async () => {
        const corpus = loadCorpus();
        const first = await seedCorpus(getDb(), { ownerUserId: owner, corpus });
        const second = await seedCorpus(getDb(), { ownerUserId: owner, corpus });

        expect(first.concepts).toBe(corpus.concepts.length);
        expect(first.sections).toBe(corpus.source.sections.length);
        expect(first.acts).toBe(corpus.acts.length);
        expect(second.acts).toBe(0);
        expect(second.relations).toBe(0);
    });

    it('grounds every act in the source', async () => {
        const corpus = loadCorpus();
        await seedCorpus(getDb(), { ownerUserId: owner, corpus });

        const acts = await getDb()('acts').where({ origin: 'authored' });
        expect(acts).toHaveLength(corpus.acts.length);

        for (const act of acts) {
            const grounding = await getDb()('act_grounding').where({ act_id: act.id });
            expect(grounding).toHaveLength(1);
        }
    });

    it('finds an act for each queried concept without leaving its closure', async () => {
        await seedCorpus(getDb(), { ownerUserId: owner });

        for (const query of [
            { slug: 'trapezregel', text: 'Wie rechne ich eine Trapezregel mit zwei Teilen?' },
            { slug: 'fehlerordnung', text: 'Warum viertelt sich der Fehler beim Halbieren?' },
            { slug: 'simpsonregel', text: 'Was macht die Simpsonregel genau?' },
        ]) {
            const goalId = await conceptId(query.slug);
            const result = await retrieveFor(query.slug, query.text);
            const top = result.candidates[0];

            expect(top).toBeDefined();
            expect(result.candidates.map((candidate) => candidate.conceptId)).toContain(goalId);

            const closureIds = new Set(result.snapshot.closure.map((entry) => entry.conceptId));
            for (const candidate of result.candidates) {
                expect(closureIds.has(candidate.conceptId)).toBe(true);
            }
        }
    });

    it('reaches a prerequisite that the question does not name', async () => {
        await seedCorpus(getDb(), { ownerUserId: owner });
        const trapezId = await conceptId('trapezregel');

        const result = await retrieveFor('simpsonregel', 'Was macht die Simpsonregel genau?');
        const prerequisite = result.candidates.find((candidate) => candidate.conceptId === trapezId);

        expect(prerequisite).toBeDefined();
        expect(prerequisite?.hop).toBe(1);
        expect(result.snapshot.closure).toContainEqual({ conceptId: trapezId, hop: 1 });
    });

    it('keeps a draft of another user out of the corpus result', async () => {
        await seedCorpus(getDb(), { ownerUserId: owner });
        const simpson = await conceptId('simpsonregel');
        const template = await getDb()('templates').where({ key: 'retrieval-practice', version: 1 }).first();
        if (!template) {
            throw new Error('template missing');
        }

        const [draft] = await getDb()('acts')
            .insert({
                concept_id: simpson,
                template_id: template.id,
                template_version: template.version,
                owner_user_id: other,
                origin: 'authored',
                status: 'proposed',
                title: 'Fremder Entwurf zur Simpsonregel',
                script: {
                    steps: [
                        { role: 'prompt', text: 'Was macht die Simpsonregel?' },
                        { role: 'recall', text: 'Antworte.' },
                        { role: 'check', text: 'Vergleiche.' },
                    ],
                    success: { criterion: 'Die Antwort nennt die Parabeln.' },
                },
                script_text: 'Fremder Entwurf zur Simpsonregel',
                content_hash: `draft-${crypto.randomUUID()}`,
            })
            .returning('*');

        const result = await retrieveFor('simpsonregel', 'Was macht die Simpsonregel genau?');

        expect(result.candidates.map((candidate) => candidate.actId)).not.toContain(draft.id);
    });
});
