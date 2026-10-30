import { slugify } from '@/lib/slug';
import type { Concepts, Tables } from '@/types/db_schemas';
import type { Knex } from 'knex';

export type ConceptCandidate = {
    title: string;
    language: string;
    summary: string | null;
    wikidataQid: string | null;
    createdByUserId: string;
};

const UNIQUE_VIOLATION = '23505';

const isUniqueViolation = (error: unknown) => (error as { code?: string }).code === UNIQUE_VIOLATION;

const findByQid = (db: Knex<Tables>, wikidataQid: string) =>
    db('concepts').where({ wikidata_qid: wikidataQid }).first();

const findBySlug = (db: Knex<Tables>, language: string, slug: string) =>
    db('concepts').where({ language, slug }).first();

const attachQid = async (db: Knex<Tables>, concept: Concepts, wikidataQid: string): Promise<Concepts> => {
    if (concept.wikidata_qid !== null) {
        return concept;
    }
    try {
        const [updated] = await db('concepts')
            .where({ id: concept.id })
            .whereNull('wikidata_qid')
            .update({ wikidata_qid: wikidataQid })
            .returning('*');
        return updated ?? concept;
    } catch (error) {
        if (!isUniqueViolation(error)) {
            throw error;
        }
        return (await findByQid(db, wikidataQid)) ?? concept;
    }
};

export const resolveConcept = async (db: Knex<Tables>, candidate: ConceptCandidate): Promise<Concepts> => {
    if (candidate.wikidataQid !== null) {
        const known = await findByQid(db, candidate.wikidataQid);
        if (known) {
            return known;
        }
    }

    const slug = slugify(candidate.title);
    if (!slug) {
        throw new Error(`Concept title yields an empty slug: ${JSON.stringify(candidate.title)}`);
    }

    const existing = await findBySlug(db, candidate.language, slug);
    if (existing) {
        return candidate.wikidataQid === null ? existing : attachQid(db, existing, candidate.wikidataQid);
    }

    try {
        const [created] = await db('concepts')
            .insert({
                slug,
                title: candidate.title.trim(),
                language: candidate.language,
                summary: candidate.summary,
                wikidata_qid: candidate.wikidataQid,
                created_by_user_id: candidate.createdByUserId,
            })
            .returning('*');
        return created;
    } catch (error) {
        if (!isUniqueViolation(error)) {
            throw error;
        }
        const raced = await findBySlug(db, candidate.language, slug);
        if (!raced) {
            throw error;
        }
        return raced;
    }
};
