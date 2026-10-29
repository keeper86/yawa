import { sourceKindSchema } from '@/types/enums';
import { getDb, testUsers } from 'tests/vitest/setupTestcontainer';
import { describe, expect, it } from 'vitest';

const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';

const uniqueExternalId = () => `paste:${crypto.randomUUID()}`;

const insertSource = (overrides: Record<string, unknown> = {}) => {
    const db = getDb();
    return db('sources')
        .insert({
            kind: 'paste',
            external_id: uniqueExternalId(),
            title: 'Skript Numerik',
            language: 'de',
            license: 'own-work',
            ...overrides,
        })
        .returning('*');
};

const insertSection = (sourceId: string, position = 0) => {
    const db = getDb();
    return db('source_sections')
        .insert({
            source_id: sourceId,
            position,
            heading: 'Trapezregel',
            content: 'Die Trapezregel naehert das Integral durch Trapeze an.',
            content_hash: 'hash-of-content',
        })
        .returning('*');
};

describe('sources schema', () => {
    it('deduplicates shared sources by external id', async () => {
        const externalId = uniqueExternalId();
        await insertSource({ external_id: externalId, owner_user_id: null });

        await expect(insertSource({ external_id: externalId, owner_user_id: null })).rejects.toMatchObject({
            code: UNIQUE_VIOLATION,
        });
    });

    it('lets two owners hold the same external id and deduplicates per owner', async () => {
        const externalId = uniqueExternalId();
        await insertSource({ external_id: externalId, owner_user_id: testUsers.testUser.user_id });
        await insertSource({ external_id: externalId, owner_user_id: testUsers.otherUser.user_id });

        await expect(
            insertSource({ external_id: externalId, owner_user_id: testUsers.testUser.user_id }),
        ).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
    });

    it('rejects an unknown source kind', async () => {
        await expect(insertSource({ kind: 'pdf' })).rejects.toMatchObject({ code: '23514' });
    });

    it('keeps the zod kinds in sync with the database check constraint', async () => {
        const result = await getDb().raw(
            `SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname = 'sources_kind_check'`,
        );
        const definition: string = result.rows[0].definition;
        const allowed = [...definition.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]).sort();

        expect(allowed).toEqual([...sourceKindSchema.options].sort());
    });

    it('cascades sections when a source is deleted and refuses duplicate positions', async () => {
        const [source] = await insertSource();
        const [section] = await insertSection(source.id);
        expect(section.source_id).toBe(source.id);

        await expect(insertSection(source.id, 0)).rejects.toMatchObject({ code: UNIQUE_VIOLATION });

        await getDb()('sources').where({ id: source.id }).del();
        const remaining = await getDb()('source_sections').where({ source_id: source.id });
        expect(remaining).toHaveLength(0);
    });

    it('refuses a section without an existing source', async () => {
        await expect(insertSection(crypto.randomUUID())).rejects.toMatchObject({ code: FOREIGN_KEY_VIOLATION });
    });
});
