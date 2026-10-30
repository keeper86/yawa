import { DomainFailure } from '../domainError';
import { logger } from '../logger';
import type { AiProvider } from '../ai';
import type { Tables } from '@/types/db_schemas';
import type { Knex } from 'knex';

export type EmbedOptions = {
    limit?: number;
    batchSize?: number;
    actIds?: string[];
    ownerUserId?: string;
};

export type EmbedResult = {
    embedded: number;
    remaining: number;
};

const DEFAULT_LIMIT = 200;
const DEFAULT_BATCH_SIZE = 8;

const vectorLiteral = (vector: number[]) => `[${vector.join(',')}]`;

export const embedPendingActs = async (
    db: Knex<Tables>,
    ai: AiProvider,
    options: EmbedOptions = {},
): Promise<EmbedResult> => {
    const limit = options.limit ?? DEFAULT_LIMIT;
    const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;

    const pendingQuery = () => {
        const query = db('acts').whereNull('embedding');
        if (options.ownerUserId !== undefined) {
            query.where('owner_user_id', options.ownerUserId);
        }
        if (options.actIds !== undefined) {
            query.whereIn('id', options.actIds);
        }
        return query;
    };

    const counts = await pendingQuery().count<{ count: string }>('* as count').first();
    const pending = Number(counts?.count ?? 0);
    if (pending === 0) {
        return { embedded: 0, remaining: 0 };
    }

    const rows = await pendingQuery().orderBy('created_at').limit(Math.min(limit, pending)).select('id', 'script_text');

    let embedded = 0;
    for (let index = 0; index < rows.length; index += batchSize) {
        const batch = rows.slice(index, index + batchSize);

        let vectors: number[][];
        try {
            vectors = await ai.embed(batch.map((row) => row.script_text));
        } catch (error) {
            if (error instanceof DomainFailure && error.domainCode === 'embeddingDimensionMismatch') {
                throw error;
            }
            logger.warn(
                { batchStart: index, size: batch.length, error: (error as Error).message },
                'embedding batch failed',
            );
            continue;
        }

        const embeddedAt = new Date();
        await db.transaction(async (trx) => {
            for (let position = 0; position < batch.length; position += 1) {
                await trx('acts')
                    .where({ id: batch[position].id })
                    .whereNull('embedding')
                    .update({
                        embedding: trx.raw('?::vector', [vectorLiteral(vectors[position])]),
                        embedding_model: ai.embeddingModel,
                        embedded_at: embeddedAt,
                    });
            }
        });
        embedded += batch.length;
    }

    const left = await pendingQuery().count<{ count: string }>('* as count').first();
    return { embedded, remaining: Number(left?.count ?? 0) };
};
