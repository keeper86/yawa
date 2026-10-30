import { resolveConcept } from '@/server/concept/resolve';
import type { Script } from '@/server/templates';
import { actContentHash, actText } from '@/lib/actScript';
import { actOriginSchema, actStatusSchema } from '@/types/enums';
import { constraintEnumValues } from 'tests/vitest/enumConstraint';
import { getDb, testUsers } from 'tests/vitest/setupTestcontainer';
import { describe, expect, it } from 'vitest';

const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';
const CHECK_VIOLATION = '23514';
const EMBEDDING_DIM = 768;

const script: Script = {
    steps: [
        { role: 'setup', text: 'Gesucht ist das Integral von x^2 ueber [0, 1].' },
        { role: 'model', text: 'Wir zerlegen das Intervall in zwei Trapeze.' },
        { role: 'check', text: 'Berechne den zweiten Trapezterm.' },
    ],
    success: { criterion: 'Der zweite Trapezterm ist korrekt ausgerechnet.' },
};

const vectorLiteral = (dimensions: number) => `[${Array.from({ length: dimensions }, () => 0.1).join(',')}]`;

const createAct = async (overrides: Record<string, unknown> = {}) => {
    const db = getDb();
    const concept = await resolveConcept(db, {
        title: `Konzept ${crypto.randomUUID()}`,
        language: 'de',
        summary: null,
        wikidataQid: null,
        createdByUserId: testUsers.testUser.user_id,
    });
    const template = await db('templates').where({ key: 'worked-example', version: 1 }).first();
    if (!template) {
        throw new Error('worked-example template missing');
    }
    const title = 'Trapezregel';
    const text = actText({ title, script });

    const [created] = await db('acts')
        .insert({
            concept_id: concept.id,
            template_id: template.id,
            template_version: template.version,
            owner_user_id: testUsers.testUser.user_id,
            origin: 'generated',
            title,
            script,
            script_text: text,
            content_hash: actContentHash(text, template.key, template.version),
            ...overrides,
        })
        .returning('*');

    return created;
};

const createSourceSection = async () => {
    const db = getDb();
    const [source] = await db('sources')
        .insert({
            kind: 'paste',
            external_id: `paste:${crypto.randomUUID()}`,
            title: 'Skript',
            language: 'de',
            license: 'own-work',
            owner_user_id: testUsers.testUser.user_id,
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
    return section;
};

describe('acts schema', () => {
    it('keeps the origin and status enums in sync with the check constraints', async () => {
        expect(await constraintEnumValues('acts', 'origin')).toEqual([...actOriginSchema.options].sort());
        expect(await constraintEnumValues('acts', 'status')).toEqual([...actStatusSchema.options].sort());
    });

    it('starts every act as proposed', async () => {
        const act = await createAct();
        expect(act.status).toBe('proposed');
        expect(act.published_at).toBeNull();
        expect(act.reviewed_at).toBeNull();
    });

    it('refuses a publication timestamp on an act that was not accepted', async () => {
        await expect(createAct({ published_at: new Date() })).rejects.toMatchObject({ code: CHECK_VIOLATION });
    });

    it('accepts a publication timestamp once the act is accepted', async () => {
        const act = await createAct({ status: 'accepted', published_at: new Date() });
        expect(act.published_at).not.toBeNull();
    });

    it('refuses a vector of the wrong dimension', async () => {
        const act = await createAct();
        await expect(
            getDb().raw(`UPDATE acts SET embedding = ?::vector WHERE id = ?`, [vectorLiteral(3), act.id]),
        ).rejects.toThrow(/768/);
    });

    it('stores a 768 dimensional embedding', async () => {
        const act = await createAct();
        await getDb().raw(`UPDATE acts SET embedding = ?::vector, embedding_model = ? WHERE id = ?`, [
            vectorLiteral(EMBEDDING_DIM),
            'embeddinggemma',
            act.id,
        ]);
        const stored = await getDb()('acts').where({ id: act.id }).first();
        expect(stored?.embedding).not.toBeNull();
        expect(stored?.embedding_model).toBe('embeddinggemma');
    });

    it('refuses to delete a source section an act is grounded in', async () => {
        const act = await createAct();
        const section = await createSourceSection();
        await getDb()('act_grounding').insert({ act_id: act.id, source_section_id: section.id });

        await expect(getDb()('source_sections').where({ id: section.id }).del()).rejects.toMatchObject({
            code: FOREIGN_KEY_VIOLATION,
        });
    });

    it('drops grounding rows with the act', async () => {
        const act = await createAct();
        const section = await createSourceSection();
        await getDb()('act_grounding').insert({ act_id: act.id, source_section_id: section.id });

        await getDb()('acts').where({ id: act.id }).del();
        expect(await getDb()('act_grounding').where({ act_id: act.id })).toHaveLength(0);
    });

    it('refuses duplicate grounding and duplicate references', async () => {
        const act = await createAct();
        const section = await createSourceSection();
        await getDb()('act_grounding').insert({ act_id: act.id, source_section_id: section.id });
        await expect(
            getDb()('act_grounding').insert({ act_id: act.id, source_section_id: section.id }),
        ).rejects.toMatchObject({ code: UNIQUE_VIOLATION });

        await getDb()('act_references').insert({ act_id: act.id, concept_id: act.concept_id });
        await expect(
            getDb()('act_references').insert({ act_id: act.id, concept_id: act.concept_id }),
        ).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
    });

    it('refuses an act without an existing concept', async () => {
        await expect(createAct({ concept_id: crypto.randomUUID() })).rejects.toMatchObject({
            code: FOREIGN_KEY_VIOLATION,
        });
    });

    it('refuses to delete a template that acts still use', async () => {
        await createAct();
        await expect(getDb()('templates').where({ key: 'worked-example', version: 1 }).del()).rejects.toMatchObject({
            code: FOREIGN_KEY_VIOLATION,
        });
    });

    it('serves a similarity search through the hnsw index', async () => {
        const act = await createAct();
        await getDb().raw(`UPDATE acts SET embedding = ?::vector WHERE id = ?`, [vectorLiteral(EMBEDDING_DIM), act.id]);

        const plan = await getDb().transaction(async (trx) => {
            await trx.raw('SET LOCAL enable_seqscan = off');
            const result = await trx.raw(`EXPLAIN SELECT id FROM acts ORDER BY embedding <=> ?::vector LIMIT 5`, [
                vectorLiteral(EMBEDDING_DIM),
            ]);
            return (result.rows as { 'QUERY PLAN': string }[]).map((row) => row['QUERY PLAN']).join('\n');
        });

        expect(plan).toContain('idx_acts_embedding');
    });
});
