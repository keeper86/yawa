import type { ConceptRelations, Tables } from '@/types/db_schemas';
import type { RelationStatus, RelationType } from '@/types/enums';
import type { Knex } from 'knex';
import { DomainFailure } from '../domainError';

export type RelationCandidate = {
    sourceConceptId: string;
    targetConceptId: string;
    type: RelationType;
    status: RelationStatus;
    createdByUserId: string;
};

const canonicalOrder = (candidate: RelationCandidate): [string, string] => {
    if (candidate.type !== 'contrasts_with') {
        return [candidate.sourceConceptId, candidate.targetConceptId];
    }
    return candidate.sourceConceptId < candidate.targetConceptId
        ? [candidate.sourceConceptId, candidate.targetConceptId]
        : [candidate.targetConceptId, candidate.sourceConceptId];
};

export const createsRequiresCycle = async (
    db: Knex<Tables>,
    sourceConceptId: string,
    targetConceptId: string,
): Promise<boolean> => {
    const result = await db.raw(
        `
        WITH RECURSIVE reach(concept_id) AS (
            SELECT ?::uuid
            UNION
            SELECT r.target_concept_id
            FROM concept_relations r
            JOIN reach ON r.source_concept_id = reach.concept_id
            WHERE r.type = 'requires' AND r.status <> 'rejected'
        )
        SELECT EXISTS (SELECT 1 FROM reach WHERE concept_id = ?::uuid) AS cycle
        `,
        [targetConceptId, sourceConceptId],
    );

    return Boolean(result.rows[0]?.cycle);
};

export const linkConcepts = async (
    db: Knex<Tables>,
    candidate: RelationCandidate,
): Promise<{ relation: ConceptRelations; created: boolean }> => {
    const [sourceConceptId, targetConceptId] = canonicalOrder(candidate);
    if (sourceConceptId === targetConceptId) {
        throw new DomainFailure('relationCycle', 'A concept cannot be related to itself');
    }

    return db.transaction(async (trx) => {
        const locked = await trx('concepts')
            .whereIn('id', [sourceConceptId, targetConceptId])
            .orderBy('id')
            .forUpdate()
            .select('id');
        if (locked.length !== 2) {
            throw new DomainFailure('conceptNotFound', 'Both concepts must exist before they can be related');
        }

        const existing = await trx('concept_relations')
            .where({
                source_concept_id: sourceConceptId,
                target_concept_id: targetConceptId,
                type: candidate.type,
            })
            .first();
        if (existing) {
            return { relation: existing, created: false };
        }

        if (candidate.type === 'requires' && (await createsRequiresCycle(trx, sourceConceptId, targetConceptId))) {
            throw new DomainFailure(
                'relationCycle',
                `Relation ${sourceConceptId} -> ${targetConceptId} would create a requires cycle`,
            );
        }

        const [relation] = await trx('concept_relations')
            .insert({
                source_concept_id: sourceConceptId,
                target_concept_id: targetConceptId,
                type: candidate.type,
                status: candidate.status,
                created_by_user_id: candidate.createdByUserId,
            })
            .returning('*');

        return { relation, created: true };
    });
};
