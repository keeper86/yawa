import type { Tables } from '@/types/db_schemas';
import type { Knex } from 'knex';
import { RRF_K } from './rank';

const DEFAULT_LIMIT = 20;

const visibleTo = (viewerUserId: string) => (builder: Knex.QueryBuilder) =>
    builder.whereNotNull('acts.published_at').orWhere('acts.owner_user_id', viewerUserId);

export const vectorSeed = async (
    db: Knex<Tables>,
    vector: number[],
    viewerUserId: string,
    limit = DEFAULT_LIMIT,
): Promise<string[]> => {
    const rows = await db('acts')
        .whereNotNull('acts.embedding')
        .where(visibleTo(viewerUserId))
        .orderByRaw('acts.embedding <=> ?::vector', [`[${vector.join(',')}]`])
        .limit(limit)
        .select('acts.id');

    return rows.map((row) => row.id);
};

export const lexicalSeed = async (
    db: Knex<Tables>,
    query: string,
    viewerUserId: string,
    limit = DEFAULT_LIMIT,
): Promise<string[]> => {
    const rows = await db('acts')
        .whereRaw(`to_tsvector('simple', acts.script_text) @@ websearch_to_tsquery('simple', ?)`, [query])
        .where(visibleTo(viewerUserId))
        .orderByRaw(`ts_rank_cd(to_tsvector('simple', acts.script_text), websearch_to_tsquery('simple', ?)) DESC`, [
            query,
        ])
        .limit(limit)
        .select('acts.id');

    return rows.map((row) => row.id);
};

export const fuseRankings = (rankings: string[][], k = RRF_K): Map<string, number> => {
    const scores = new Map<string, number>();

    for (const ranking of rankings) {
        ranking.forEach((actId, index) => {
            const contribution = 1 / (k + index + 1);
            scores.set(actId, (scores.get(actId) ?? 0) + contribution);
        });
    }

    return scores;
};
