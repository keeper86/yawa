import type { TemplateKey } from '@/server/templates';
import type { Tables } from '@/types/db_schemas';
import type { ActOrigin, ActStatus, RelationStatus } from '@/types/enums';
import type { Knex } from 'knex';

export type TraversalOptions = {
    depth: 1 | 2;
    statuses: RelationStatus[];
};

export type ActCandidate = {
    id: string;
    conceptId: string;
    templateKey: TemplateKey;
    templateVersion: number;
    title: string;
    origin: ActOrigin;
    status: ActStatus;
    ownerUserId: string;
    publishedAt: Date | null;
};

export const prerequisiteClosure = async (
    db: Knex<Tables>,
    conceptIds: string[],
    options: TraversalOptions,
): Promise<Map<string, number>> => {
    if (conceptIds.length === 0) {
        return new Map();
    }

    const result = await db.raw(
        `
        WITH RECURSIVE walk(concept_id, hop) AS (
            SELECT unnest(?::uuid[]), 0
            UNION
            SELECT r.target_concept_id, w.hop + 1
            FROM concept_relations r
            JOIN walk w ON r.source_concept_id = w.concept_id
            WHERE r.type = 'requires'
              AND r.status = ANY(?::text[])
              AND w.hop < ?
        )
        SELECT concept_id, min(hop) AS hop
        FROM walk
        WHERE hop > 0
        GROUP BY concept_id
        `,
        [conceptIds, options.statuses, options.depth],
    );

    const hops = new Map<string, number>();
    for (const row of result.rows as { concept_id: string; hop: number }[]) {
        hops.set(row.concept_id, row.hop);
    }
    return hops;
};

export const actsForConcepts = async (
    db: Knex<Tables>,
    conceptIds: string[],
    viewerUserId: string,
): Promise<ActCandidate[]> => {
    if (conceptIds.length === 0) {
        return [];
    }

    const rows = await db('acts')
        .join('templates', 'templates.id', 'acts.template_id')
        .whereIn('acts.concept_id', conceptIds)
        .andWhere((builder) => builder.whereNotNull('acts.published_at').orWhere('acts.owner_user_id', viewerUserId))
        .select(
            'acts.id',
            'acts.concept_id',
            'acts.template_version',
            'acts.title',
            'acts.origin',
            'acts.status',
            'acts.owner_user_id',
            'acts.published_at',
            'templates.key as template_key',
        );

    return rows.map((row) => ({
        id: row.id,
        conceptId: row.concept_id,
        templateKey: row.template_key as TemplateKey,
        templateVersion: row.template_version,
        title: row.title,
        origin: row.origin as ActOrigin,
        status: row.status as ActStatus,
        ownerUserId: row.owner_user_id,
        publishedAt: row.published_at,
    }));
};
