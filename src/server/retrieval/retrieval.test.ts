import { actContentHash, actText } from '@/lib/actScript';
import { createFakeProvider } from '@/server/ai/fake';
import { resolveConcept } from '@/server/concept/resolve';
import { linkConcepts } from '@/server/graph/relations';
import type { Script } from '@/server/templates';
import { getDb, testUsers } from 'tests/vitest/setupTestcontainer';
import { describe, expect, it } from 'vitest';
import { retrieve } from './index';
import { hopDecay, qualityShrinkage, templateFit } from './rank';
import { fuseRankings, lexicalSeed } from './seed';

const owner = testUsers.testUser.user_id;
const other = testUsers.otherUser.user_id;
const QUERY = 'Warum stimmt meine Simpson-Naeherung nicht?';

const embedding = (basis: number) => Array.from({ length: 768 }, (_, index) => (index === basis ? 1 : 0));

const diagnosis = {
    mastery: 0.3,
    confidence: 0.5,
    evidenceCount: 2,
    lastSeenDaysAgo: 3,
    misconception: true,
};

const concept = (title: string) =>
    resolveConcept(getDb(), {
        title,
        language: 'de',
        summary: null,
        wikidataQid: null,
        createdByUserId: owner,
    });

const script = (text: string): Script => ({
    steps: [
        { role: 'setup', text },
        { role: 'model', text: 'Wir zerlegen das Intervall in zwei Trapeze.' },
        { role: 'check', text: 'Berechne den zweiten Trapezterm.' },
    ],
    success: { criterion: 'Der zweite Trapezterm ist korrekt ausgerechnet.' },
});

const addAct = async (options: {
    conceptId: string;
    templateKey: string;
    text: string;
    basis: number | null;
    ownerUserId?: string;
    published?: boolean;
}) => {
    const db = getDb();
    const template = await db('templates').where({ key: options.templateKey, version: 1 }).first();
    if (!template) {
        throw new Error(`template ${options.templateKey} missing`);
    }
    const title = options.text.slice(0, 40);
    const body = script(options.text);
    const text = actText({ title, script: body });
    const [act] = await db('acts')
        .insert({
            concept_id: options.conceptId,
            template_id: template.id,
            template_version: template.version,
            owner_user_id: options.ownerUserId ?? owner,
            origin: 'authored',
            status: options.published === false ? 'proposed' : 'accepted',
            published_at: options.published === false ? null : new Date(),
            title,
            script: body,
            script_text: text,
            content_hash: actContentHash(text, template.key, template.version),
        })
        .returning('*');

    if (options.basis !== null) {
        await db.raw('UPDATE acts SET embedding = ?::vector, embedding_model = ? WHERE id = ?', [
            `[${embedding(options.basis).join(',')}]`,
            'test',
            act.id,
        ]);
    }
    return act;
};

const ai = () => createFakeProvider({ embeddingDim: 768, embeddings: new Map([[QUERY, embedding(0)]]) });

const setupGraph = async () => {
    const interpolation = await concept(`Interpolation ${crypto.randomUUID().slice(0, 6)}`);
    const simpson = await concept(`Simpsonregel ${crypto.randomUUID().slice(0, 6)}`);
    await linkConcepts(getDb(), {
        sourceConceptId: simpson.id,
        targetConceptId: interpolation.id,
        type: 'requires',
        status: 'published',
        createdByUserId: owner,
    });
    return { interpolation, simpson };
};

describe('retrieval', () => {
    it('reaches a prerequisite act that shares no vocabulary with the question', async () => {
        const { interpolation, simpson } = await setupGraph();

        const interpolationAct = await addAct({
            conceptId: interpolation.id,
            templateKey: 'worked-example',
            text: 'Stuetzstellen gleichmaessig waehlen und die Sehnenflaechen summieren.',
            basis: 5,
        });
        for (let index = 0; index < 22; index += 1) {
            await addAct({
                conceptId: simpson.id,
                templateKey: 'worked-example',
                text: `Die Simpson-Naeherung, Variante ${index}, nutzt Parabeln durch je drei Punkte.`,
                basis: 0,
            });
        }

        const lexical = await lexicalSeed(getDb(), QUERY, owner);
        expect(lexical).not.toContain(interpolationAct.id);

        const result = await retrieve(getDb(), ai(), {
            viewerUserId: owner,
            goalConceptId: simpson.id,
            query: QUERY,
            diagnosis,
        });

        const found = result.candidates.find((candidate) => candidate.actId === interpolationAct.id);
        expect(found).toBeDefined();
        expect(found?.hop).toBe(1);
        expect(found?.via).toBe('graph');
        expect(result.snapshot.graphOnlySeeds).toContain(interpolationAct.id);
        expect(result.snapshot.closure).toContainEqual({ conceptId: interpolation.id, hop: 1 });
    });

    it('never returns an unpublished act of another user', async () => {
        const { simpson } = await setupGraph();
        const foreignDraft = await addAct({
            conceptId: simpson.id,
            templateKey: 'worked-example',
            text: 'Die Simpson-Naeherung eines fremden Entwurfs.',
            basis: 0,
            ownerUserId: other,
            published: false,
        });

        const result = await retrieve(getDb(), ai(), {
            viewerUserId: owner,
            goalConceptId: simpson.id,
            query: QUERY,
            diagnosis,
        });

        expect(result.candidates.map((candidate) => candidate.actId)).not.toContain(foreignDraft.id);
    });

    it('counts acts without an embedding instead of hiding them', async () => {
        const { simpson } = await setupGraph();
        await addAct({
            conceptId: simpson.id,
            templateKey: 'worked-example',
            text: 'Die Simpson-Naeherung ohne Vektor.',
            basis: null,
        });

        const result = await retrieve(getDb(), ai(), {
            viewerUserId: owner,
            goalConceptId: simpson.id,
            query: QUERY,
            diagnosis,
        });

        expect(result.snapshot.excludedWithoutEmbedding).toBeGreaterThanOrEqual(1);
    });
});

describe('ranking components', () => {
    it('prefers contrasting cases when the learner has a misconception', () => {
        expect(templateFit({ ...diagnosis, misconception: true }, 'contrasting-cases')).toBeGreaterThan(
            templateFit({ ...diagnosis, misconception: true }, 'retrieval-practice'),
        );
    });

    it('shrinks the quality of a rarely used act towards the prior', () => {
        expect(qualityShrinkage(0, null)).toBeCloseTo(0.5);
        expect(qualityShrinkage(1, 1)).toBeLessThan(0.7);
        expect(qualityShrinkage(1000, 1)).toBeGreaterThan(0.99);
        expect(qualityShrinkage(10, 0.2)).toBeLessThan(0.6);
    });

    it('decays with hop distance and stays positive', () => {
        expect(hopDecay(0)).toBeGreaterThan(hopDecay(1));
        expect(hopDecay(1)).toBeGreaterThan(hopDecay(2));
        expect(hopDecay(null)).toBeGreaterThan(0);
    });

    it('fuses two rankings by reciprocal rank', () => {
        const fused = fuseRankings([
            ['a', 'b'],
            ['b', 'a'],
        ]);

        expect(fused.get('a')).toBeCloseTo(fused.get('b') ?? 0);
        expect(fused.get('a')).toBeGreaterThan(0);
    });
});
