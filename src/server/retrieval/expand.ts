import type { Tables } from '@/types/db_schemas';
import type { Knex } from 'knex';
import { prerequisiteClosure } from '../graph/traversal';

export const conceptHops = async (db: Knex<Tables>, goalConceptId: string): Promise<Map<string, number>> => {
    const hops = new Map<string, number>([[goalConceptId, 0]]);
    const closure = await prerequisiteClosure(db, [goalConceptId], { depth: 2, statuses: ['published'] });

    for (const [conceptId, hop] of closure) {
        hops.set(conceptId, hop);
    }

    return hops;
};

export const actsInClosure = async (
    db: Knex<Tables>,
    hops: Map<string, number>,
    viewerUserId: string,
): Promise<{ actId: string; conceptId: string; hop: number }[]> => {
    const rows = await db('acts')
        .whereIn('acts.concept_id', [...hops.keys()])
        .where((builder) => builder.whereNotNull('acts.published_at').orWhere('acts.owner_user_id', viewerUserId))
        .select('acts.id', 'acts.concept_id');

    return rows.map((row) => ({
        actId: row.id,
        conceptId: row.concept_id,
        hop: hops.get(row.concept_id) ?? 0,
    }));
};
