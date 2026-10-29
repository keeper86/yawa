import { briefSchema, validateBriefScope } from '@/lib/lectureBrief';
import type { Lectures, Tables } from '@/types/db_schemas';
import type { Knex } from 'knex';
import { DomainFailure } from '../domainError';

export type PublishLectureInput = {
    lectureId: string;
    userId: string;
};

const scopeSlugs = async (db: Knex<Tables>, lectureId: string): Promise<string[]> =>
    db('lecture_concepts')
        .join('concepts', 'concepts.id', 'lecture_concepts.concept_id')
        .where('lecture_concepts.lecture_id', lectureId)
        .pluck('concepts.slug');

export const publishLecture = async (db: Knex<Tables>, input: PublishLectureInput): Promise<Lectures> => {
    return db.transaction(async (trx) => {
        const lecture = await trx('lectures').where({ id: input.lectureId }).forUpdate().first();
        if (!lecture) {
            throw new DomainFailure('lectureNotFound', `Lecture ${input.lectureId} not found`);
        }
        if (lecture.owner_user_id !== input.userId) {
            throw new DomainFailure('notOwner', 'Only the owner can publish a lecture');
        }
        if (lecture.published_at !== null) {
            return lecture;
        }

        const parsed = briefSchema.safeParse(lecture.brief);
        if (!parsed.success) {
            const fields = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
            throw new DomainFailure('invalidBrief', `Brief is invalid: ${fields}`);
        }
        try {
            validateBriefScope(parsed.data, await scopeSlugs(trx, input.lectureId));
        } catch (error) {
            throw new DomainFailure('invalidBrief', (error as Error).message);
        }

        const acts = await trx('lecture_acts')
            .join('acts', 'acts.id', 'lecture_acts.act_id')
            .join('concepts', 'concepts.id', 'acts.concept_id')
            .where('lecture_acts.lecture_id', input.lectureId)
            .select('acts.*', 'concepts.slug as concept_slug');

        if (acts.length === 0) {
            throw new DomainFailure('lectureNotPublishable', 'Lecture has no acts');
        }

        const actIds = acts.map((act) => act.id);
        const grounded = new Set(await trx('act_grounding').whereIn('act_id', actIds).pluck('act_id'));
        const blocking = acts.filter(
            (act) => act.status !== 'accepted' || (act.origin === 'generated' && !grounded.has(act.id)),
        );
        if (blocking.length > 0) {
            throw new DomainFailure(
                'lectureNotPublishable',
                `Lecture not publishable: ${blocking.length} act(s) are proposed, rejected or missing grounding`,
            );
        }

        const covered = new Set(acts.map((act) => act.concept_slug));
        const uncovered = parsed.data.mustCover.filter((slug) => !covered.has(slug));
        if (uncovered.length > 0) {
            throw new DomainFailure(
                'lectureNotPublishable',
                `Lecture not publishable: no act covers ${uncovered.join(', ')}`,
            );
        }

        const now = new Date();
        await trx('acts')
            .whereIn('id', actIds)
            .update({
                published_at: now,
                reviewed_at: trx.raw('COALESCE(reviewed_at, ?)', [now]),
                reviewed_by_user_id: trx.raw('COALESCE(reviewed_by_user_id, ?)', [input.userId]),
            });

        const [published] = await trx('lectures')
            .where({ id: input.lectureId })
            .update({ published_at: now, updated_at: now })
            .returning('*');

        return published;
    });
};
