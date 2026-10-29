import { resolveConcept } from '@/server/concept/resolve';
import { relationStatusSchema, relationTypeSchema } from '@/types/enums';
import { constraintEnumValues } from 'tests/vitest/enumConstraint';
import { getDb, testUsers } from 'tests/vitest/setupTestcontainer';
import { describe, expect, it } from 'vitest';
import { createsRequiresCycle, linkConcepts, type RelationCandidate } from './relations';

const concept = async (title: string) =>
    resolveConcept(getDb(), {
        title,
        language: 'de',
        summary: null,
        wikidataQid: null,
        createdByUserId: testUsers.testUser.user_id,
    });

const candidate = (
    sourceConceptId: string,
    targetConceptId: string,
    type: 'requires' | 'contrasts_with' = 'requires',
) =>
    ({
        sourceConceptId,
        targetConceptId,
        type,
        status: 'published',
        createdByUserId: testUsers.testUser.user_id,
    }) satisfies RelationCandidate;

describe('concept relations', () => {
    it('keeps the relation enums in sync with the check constraints', async () => {
        expect(await constraintEnumValues('concept_relations', 'type')).toEqual([...relationTypeSchema.options].sort());
        expect(await constraintEnumValues('concept_relations', 'status')).toEqual(
            [...relationStatusSchema.options].sort(),
        );
    });

    it('links a requires edge in the given direction', async () => {
        const [numerik, analysis] = [await concept('Numerik A'), await concept('Analysis A')];
        const { relation, created } = await linkConcepts(getDb(), candidate(numerik.id, analysis.id));

        expect(created).toBe(true);
        expect(relation.source_concept_id).toBe(numerik.id);
        expect(relation.target_concept_id).toBe(analysis.id);
    });

    it('is idempotent for the same edge', async () => {
        const [left, right] = [await concept('Numerik B'), await concept('Analysis B')];
        const first = await linkConcepts(getDb(), candidate(left.id, right.id));
        const second = await linkConcepts(getDb(), candidate(left.id, right.id));

        expect(second.created).toBe(false);
        expect(second.relation.id).toBe(first.relation.id);
        expect(await getDb()('concept_relations').where({ source_concept_id: left.id })).toHaveLength(1);
    });

    it('refuses a self relation', async () => {
        const single = await concept('Numerik C');
        await expect(linkConcepts(getDb(), candidate(single.id, single.id))).rejects.toThrow(/itself/);
    });

    it('refuses a relation to a concept that does not exist', async () => {
        const existing = await concept('Numerik C2');
        await expect(linkConcepts(getDb(), candidate(existing.id, crypto.randomUUID()))).rejects.toThrow(/must exist/);
    });

    it('collapses contrasts_with to a single stored direction', async () => {
        const [first, second] = [await concept('Trapez D'), await concept('Simpson D')];
        const forward = await linkConcepts(getDb(), candidate(first.id, second.id, 'contrasts_with'));
        const backward = await linkConcepts(getDb(), candidate(second.id, first.id, 'contrasts_with'));

        expect(backward.created).toBe(false);
        expect(backward.relation.id).toBe(forward.relation.id);
        expect(await getDb()('concept_relations').where({ type: 'contrasts_with' })).toHaveLength(1);
    });

    it('refuses every edge that would close a requires chain', async () => {
        const a = await concept('Kette A');
        const b = await concept('Kette B');
        const c = await concept('Kette C');
        await linkConcepts(getDb(), candidate(a.id, b.id));
        await linkConcepts(getDb(), candidate(b.id, c.id));

        await expect(linkConcepts(getDb(), candidate(c.id, a.id))).rejects.toThrow(/cycle/);
        await expect(linkConcepts(getDb(), candidate(b.id, a.id))).rejects.toThrow(/cycle/);
        await expect(linkConcepts(getDb(), candidate(c.id, b.id))).rejects.toThrow(/cycle/);
    });

    it('accepts a shortcut across an existing chain', async () => {
        const a = await concept('Kette D');
        const b = await concept('Kette E');
        const c = await concept('Kette F');
        await linkConcepts(getDb(), candidate(a.id, b.id));
        await linkConcepts(getDb(), candidate(b.id, c.id));

        const shortcut = await linkConcepts(getDb(), candidate(a.id, c.id));
        expect(shortcut.created).toBe(true);
        expect(await createsRequiresCycle(getDb(), a.id, c.id)).toBe(false);
    });

    it('ignores rejected edges when looking for cycles', async () => {
        const a = await concept('Kette G');
        const b = await concept('Kette H');
        const { relation } = await linkConcepts(getDb(), candidate(a.id, b.id));
        await getDb()('concept_relations').where({ id: relation.id }).update({ status: 'rejected' });

        expect(await createsRequiresCycle(getDb(), b.id, a.id)).toBe(false);
        const reverse = await linkConcepts(getDb(), candidate(b.id, a.id));
        expect(reverse.created).toBe(true);
    });

    it('drops relations with the concept', async () => {
        const a = await concept('Kette I');
        const b = await concept('Kette J');
        await linkConcepts(getDb(), candidate(a.id, b.id));

        await getDb()('concepts').where({ id: b.id }).del();
        expect(await getDb()('concept_relations').where({ source_concept_id: a.id })).toHaveLength(0);
    });
});
