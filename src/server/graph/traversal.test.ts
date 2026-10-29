import { actContentHash, actText } from '@/lib/actScript';
import { resolveConcept } from '@/server/concept/resolve';
import type { Script } from '@/server/templates';
import type { RelationStatus, RelationType } from '@/types/enums';
import { getDb, testUsers } from 'tests/vitest/setupTestcontainer';
import { describe, expect, it } from 'vitest';
import { actsForConcepts, prerequisiteClosure } from './traversal';

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

const concept = (title: string) =>
    resolveConcept(getDb(), {
        title,
        language: 'de',
        summary: null,
        wikidataQid: null,
        createdByUserId: owner,
    });

const link = async (from: string, to: string, options: { type?: RelationType; status?: RelationStatus } = {}) => {
    await getDb()('concept_relations').insert({
        source_concept_id: from,
        target_concept_id: to,
        type: options.type ?? 'requires',
        status: options.status ?? 'published',
    });
};

const published = { depth: 2 as const, statuses: ['published'] as RelationStatus[] };

describe('prerequisiteClosure', () => {
    it('returns only direct prerequisites at depth one', async () => {
        const [a, b, c] = [await concept('Tiefe A'), await concept('Tiefe B'), await concept('Tiefe C')];
        await link(a.id, b.id);
        await link(b.id, c.id);

        const hops = await prerequisiteClosure(getDb(), [a.id], { depth: 1, statuses: ['published'] });

        expect(Object.fromEntries(hops)).toEqual({ [b.id]: 1 });
    });

    it('reaches two hops and stops there', async () => {
        const [a, b, c, d] = [
            await concept('Tiefe D'),
            await concept('Tiefe E'),
            await concept('Tiefe F'),
            await concept('Tiefe G'),
        ];
        await link(a.id, b.id);
        await link(b.id, c.id);
        await link(c.id, d.id);

        const hops = await prerequisiteClosure(getDb(), [a.id], published);

        expect(hops.get(b.id)).toBe(1);
        expect(hops.get(c.id)).toBe(2);
        expect(hops.has(d.id)).toBe(false);
    });

    it('reports the shortest of several paths', async () => {
        const [a, b, d] = [await concept('Pfad A'), await concept('Pfad B'), await concept('Pfad D')];
        await link(a.id, b.id);
        await link(b.id, d.id);
        await link(a.id, d.id);

        const hops = await prerequisiteClosure(getDb(), [a.id], published);

        expect(hops.get(d.id)).toBe(1);
    });

    it('never walks a rejected edge and walks a suggested one only when asked', async () => {
        const [a, b] = [await concept('Status A'), await concept('Status B')];
        await link(a.id, b.id, { status: 'rejected' });

        expect((await prerequisiteClosure(getDb(), [a.id], published)).size).toBe(0);
        expect((await prerequisiteClosure(getDb(), [a.id], { depth: 2, statuses: ['rejected'] })).get(b.id)).toBe(1);
    });

    it('does not follow contrasts_with', async () => {
        const [a, b] = [await concept('Kontrast A'), await concept('Kontrast B')];
        await link(a.id, b.id, { type: 'contrasts_with' });

        expect((await prerequisiteClosure(getDb(), [a.id], published)).size).toBe(0);
    });

    it('terminates on a cyclic graph', async () => {
        const [a, b] = [await concept('Zyklus A'), await concept('Zyklus B')];
        await link(a.id, b.id);
        await link(b.id, a.id);

        const hops = await prerequisiteClosure(getDb(), [a.id], published);

        expect(hops.get(b.id)).toBe(1);
        expect(hops.get(a.id)).toBe(2);
    });

    it('returns an empty map for an empty input', async () => {
        expect((await prerequisiteClosure(getDb(), [], published)).size).toBe(0);
    });
});

const addAct = async (conceptId: string, options: { ownerUserId: string; published: boolean }) => {
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
            owner_user_id: options.ownerUserId,
            origin: 'authored',
            status: options.published ? 'accepted' : 'proposed',
            published_at: options.published ? new Date() : null,
            title,
            script,
            script_text: text,
            content_hash: actContentHash(text, template.key, template.version),
        })
        .returning('*');
    return act;
};

describe('actsForConcepts', () => {
    it('returns published acts of everyone and drafts of the viewer only', async () => {
        const target = await concept('Sichtbarkeit');
        const ownDraft = await addAct(target.id, { ownerUserId: owner, published: false });
        const foreignDraft = await addAct(target.id, { ownerUserId: other, published: false });
        const foreignPublished = await addAct(target.id, { ownerUserId: other, published: true });

        const ids = (await actsForConcepts(getDb(), [target.id], owner)).map((act) => act.id);

        expect(ids).toContain(ownDraft.id);
        expect(ids).toContain(foreignPublished.id);
        expect(ids).not.toContain(foreignDraft.id);
    });

    it('carries the template key and the review status for ranking', async () => {
        const target = await concept('Rankingdaten');
        await addAct(target.id, { ownerUserId: owner, published: true });

        const [candidate] = await actsForConcepts(getDb(), [target.id], owner);

        expect(candidate.templateKey).toBe('worked-example');
        expect(candidate.status).toBe('accepted');
        expect(candidate.publishedAt).toBeInstanceOf(Date);
    });

    it('returns an empty list for no concepts', async () => {
        expect(await actsForConcepts(getDb(), [], owner)).toHaveLength(0);
    });
});
