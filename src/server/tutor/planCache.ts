import { beadsSchema, type Bead } from '@/lib/lesson';
import type { MasteryBucket } from '@/lib/lessonBucket';
import type { Tables } from '@/types/db_schemas';
import type { Knex } from 'knex';
import { logger } from '../logger';

export const readLesson = async (
    db: Knex<Tables>,
    act: { id: string; content_hash: string },
    bucket: MasteryBucket,
): Promise<Bead[] | null> => {
    const row = await db('act_lessons')
        .where({ act_id: act.id, content_hash: act.content_hash, bucket })
        .orderBy('created_at', 'desc')
        .first();

    if (!row) {
        return null;
    }

    const parsed = beadsSchema.safeParse(row.beads);
    if (!parsed.success) {
        logger.warn({ actId: act.id, bucket, error: parsed.error.message }, 'dropping an unreadable cached lesson');
        return null;
    }
    return parsed.data;
};

export const writeLesson = async (
    db: Knex<Tables>,
    act: { id: string; content_hash: string },
    bucket: MasteryBucket,
    beads: Bead[],
    model: string,
): Promise<void> => {
    await db('act_lessons')
        .insert({ act_id: act.id, content_hash: act.content_hash, bucket, beads: JSON.stringify(beads), model })
        .onConflict(['act_id', 'content_hash', 'bucket'])
        .ignore();
};
