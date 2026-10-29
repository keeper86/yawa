import { getDb, testUsers } from 'tests/vitest/setupTestcontainer';
import { describe, expect, it } from 'vitest';
import { type ConceptCandidate, resolveConcept } from './resolve';

const candidate = (overrides: Partial<ConceptCandidate> = {}): ConceptCandidate => ({
    title: 'Trapezregel',
    language: 'de',
    summary: null,
    wikidataQid: null,
    createdByUserId: testUsers.testUser.user_id,
    ...overrides,
});

describe('resolveConcept', () => {
    it('returns the existing concept for a differently written title', async () => {
        const db = getDb();
        const first = await resolveConcept(db, candidate({ title: 'Numerische Integration' }));
        const second = await resolveConcept(db, candidate({ title: 'numerische  Integration' }));

        expect(second.id).toBe(first.id);
        expect(await db('concepts').where({ slug: 'numerische-integration' })).toHaveLength(1);
    });

    it('keeps one concept per language', async () => {
        const db = getDb();
        const german = await resolveConcept(db, candidate({ title: 'Simpsonregel', language: 'de' }));
        const english = await resolveConcept(db, candidate({ title: 'Simpson rule', language: 'en' }));
        const englishAgain = await resolveConcept(db, candidate({ title: 'Simpson rule', language: 'en' }));

        expect(english.id).not.toBe(german.id);
        expect(englishAgain.id).toBe(english.id);
    });

    it('prefers the wikidata id over the title', async () => {
        const db = getDb();
        const byQid = await resolveConcept(db, candidate({ title: 'Trapezregel', wikidataQid: 'Q1421201' }));
        const byOtherTitle = await resolveConcept(
            db,
            candidate({ title: 'Trapez-Regel (Numerik)', wikidataQid: 'Q1421201' }),
        );

        expect(byOtherTitle.id).toBe(byQid.id);
        expect(await db('concepts').where({ wikidata_qid: 'Q1421201' })).toHaveLength(1);
    });

    it('attaches a wikidata id to a concept that was created without one', async () => {
        const db = getDb();
        const plain = await resolveConcept(db, candidate({ title: 'Fehlerordnung' }));
        expect(plain.wikidata_qid).toBeNull();

        const enriched = await resolveConcept(db, candidate({ title: 'Fehlerordnung', wikidataQid: 'Q1421202' }));
        expect(enriched.id).toBe(plain.id);
        expect(enriched.wikidata_qid).toBe('Q1421202');
    });

    it('resolves the same concept under concurrent calls', async () => {
        const db = getDb();
        const [first, second] = await Promise.all([
            resolveConcept(db, candidate({ title: 'Stuetzstelle' })),
            resolveConcept(db, candidate({ title: 'Stuetzstelle' })),
        ]);

        expect(second.id).toBe(first.id);
        expect(await db('concepts').where({ slug: 'stuetzstelle' })).toHaveLength(1);
    });

    it('refuses a title without any usable characters', async () => {
        await expect(resolveConcept(getDb(), candidate({ title: '!!!' }))).rejects.toThrow(/empty slug/);
    });
});
