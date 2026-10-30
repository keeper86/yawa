import { actContentHash, actText } from '@/lib/actScript';
import { resolveConcept } from '@/server/concept/resolve';
import { createFakeProvider } from '@/server/ai/fake';
import type { AiProvider } from '@/server/ai';
import type { Script } from '@/server/templates';
import { DomainFailure } from '@/server/domainError';
import { getDb, testUsers } from 'tests/vitest/setupTestcontainer';
import { describe, expect, it } from 'vitest';
import { embedPendingActs } from './acts';

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

const addAct = async (ownerUserId: string, title = 'Trapezregel') => {
    const db = getDb();
    const concept = await resolveConcept(db, {
        title: `Konzept ${crypto.randomUUID()}`,
        language: 'de',
        summary: null,
        wikidataQid: null,
        createdByUserId: owner,
    });
    const template = await db('templates').where({ key: 'worked-example', version: 1 }).first();
    if (!template) {
        throw new Error('template missing');
    }
    const text = actText({ title, script });
    const [act] = await db('acts')
        .insert({
            concept_id: concept.id,
            template_id: template.id,
            template_version: template.version,
            owner_user_id: ownerUserId,
            origin: 'authored',
            status: 'proposed',
            title,
            script,
            script_text: text,
            content_hash: actContentHash(text, template.key, template.version),
        })
        .returning('*');
    return act;
};

const embeddedCount = async () => {
    const rows = await getDb()('acts').whereNotNull('embedding');
    return rows.length;
};

describe('embedPendingActs', () => {
    it('embeds pending acts and records the model', async () => {
        const ai = createFakeProvider({ embeddingDim: 768 });
        await addAct(owner, 'Akt eins');
        await addAct(owner, 'Akt zwei');

        const result = await embedPendingActs(getDb(), ai);

        expect(result.embedded).toBeGreaterThanOrEqual(2);
        expect(result.remaining).toBe(0);
        const stored = await getDb()('acts').where({ title: 'Akt eins' }).first();
        expect(stored?.embedding_model).toBe('fake-embedding');
        expect(stored?.embedded_at).not.toBeNull();
    });

    it('is idempotent', async () => {
        const ai = createFakeProvider({ embeddingDim: 768 });
        await addAct(owner, 'Akt idempotent');
        await embedPendingActs(getDb(), ai);

        const second = await embedPendingActs(getDb(), ai);

        expect(second.embedded).toBe(0);
        expect(second.remaining).toBe(0);
        expect(ai.calls).toHaveLength(1);
    });

    it('writes nothing when the provider returns the wrong dimension', async () => {
        const ai = createFakeProvider({ embeddingDim: 4 });
        await addAct(owner, 'Akt Dimension');
        const before = await embeddedCount();

        await expect(embedPendingActs(getDb(), ai)).rejects.toThrow(/dimensions/);

        expect(await embeddedCount()).toBe(before);
    });

    it('keeps going when a batch fails and reports what is left', async () => {
        const base = createFakeProvider({ embeddingDim: 768 });
        let calls = 0;
        const flaky: AiProvider = {
            ...base,
            embed: async (texts) => {
                calls += 1;
                if (calls === 2) {
                    throw new DomainFailure('aiUnavailable', 'Netz weg');
                }
                return base.embed(texts);
            },
        };
        for (let index = 0; index < 12; index += 1) {
            await addAct(owner, `Akt Stapel ${index}`);
        }
        const batchIds = await getDb()('acts').whereLike('title', 'Akt Stapel %').pluck('id');

        const result = await embedPendingActs(getDb(), flaky, { batchSize: 8, actIds: batchIds });

        expect(result.embedded).toBe(8);
        expect(result.remaining).toBe(4);
    });

    it('only touches acts of the given owner', async () => {
        const ai = createFakeProvider({ embeddingDim: 768 });
        const mine = await addAct(owner, 'Meiner');
        const theirs = await addAct(other, 'Fremder');

        await embedPendingActs(getDb(), ai, { ownerUserId: owner });

        const mineStored = await getDb()('acts').where({ id: mine.id }).first();
        const theirsStored = await getDb()('acts').where({ id: theirs.id }).first();
        expect(mineStored?.embedding).not.toBeNull();
        expect(theirsStored?.embedding).toBeNull();
    });
});
