import { z } from 'zod';
import { briefSchema } from '@/lib/lectureBrief';
import type { Lectures } from '@/types/db_schemas';
import { getAi } from '../ai';
import { planLecture, runCreationJob } from '../agent/jobs';
import { db } from '../db';
import { DomainFailure } from '../domainError';
import { publishLecture } from '../lectures/publish';
import { getUserIdFromContext, protectedProcedure } from '../trpcRoot';

const lectureOutput = z.object({
    id: z.string(),
    title: z.string(),
    abstract: z.string(),
    language: z.string(),
    brief: z.unknown(),
    briefValid: z.boolean(),
    publishedAt: z.date().nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
});

const toLecture = (row: Lectures) => ({
    id: row.id,
    title: row.title,
    abstract: row.abstract,
    language: row.language,
    brief: row.brief,
    briefValid: briefSchema.safeParse(row.brief).success,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
});

const ownedLecture = async (lectureId: string, userId: string): Promise<Lectures> => {
    const lecture = await db('lectures').where({ id: lectureId }).first();
    if (!lecture) {
        throw new DomainFailure('lectureNotFound', 'Lecture not found');
    }
    if (lecture.owner_user_id !== userId) {
        throw new DomainFailure('notOwner', 'Only the owner can change this');
    }
    return lecture;
};

export const create = () =>
    protectedProcedure
        .input(z.object({ title: z.string().trim().min(1).max(200), language: z.string().min(2).max(8) }))
        .output(lectureOutput)
        .mutation(async ({ ctx, input }) => {
            const [lecture] = await db('lectures')
                .insert({
                    owner_user_id: getUserIdFromContext(ctx),
                    title: input.title,
                    language: input.language,
                })
                .returning('*');
            return toLecture(lecture);
        });

export const updateBrief = () =>
    protectedProcedure
        .input(z.object({ lectureId: z.string().uuid(), brief: briefSchema }))
        .output(lectureOutput)
        .mutation(async ({ ctx, input }) => {
            const userId = getUserIdFromContext(ctx);
            await ownedLecture(input.lectureId, userId);

            const [updated] = await db('lectures')
                .where({ id: input.lectureId })
                .update({ brief: input.brief, language: input.brief.language, updated_at: new Date() })
                .returning('*');

            return toLecture(updated);
        });

export const setScope = () =>
    protectedProcedure
        .input(
            z.object({
                lectureId: z.string().uuid(),
                conceptIds: z.array(z.string().uuid()).max(200),
                sourceIds: z.array(z.string().uuid()).max(200),
            }),
        )
        .output(lectureOutput)
        .mutation(async ({ ctx, input }) => {
            const userId = getUserIdFromContext(ctx);
            await ownedLecture(input.lectureId, userId);

            return await db.transaction(async (trx) => {
                await trx('lecture_concepts').where({ lecture_id: input.lectureId }).del();
                await trx('lecture_sources').where({ lecture_id: input.lectureId }).del();

                if (input.conceptIds.length > 0) {
                    await trx('lecture_concepts').insert(
                        input.conceptIds.map((conceptId) => ({
                            lecture_id: input.lectureId,
                            concept_id: conceptId,
                        })),
                    );
                }
                if (input.sourceIds.length > 0) {
                    await trx('lecture_sources').insert(
                        input.sourceIds.map((sourceId) => ({ lecture_id: input.lectureId, source_id: sourceId })),
                    );
                }

                const [updated] = await trx('lectures')
                    .where({ id: input.lectureId })
                    .update({ updated_at: new Date() })
                    .returning('*');

                return toLecture(updated);
            });
        });

export const setActs = () =>
    protectedProcedure
        .input(z.object({ lectureId: z.string().uuid(), actIds: z.array(z.string().uuid()).max(200) }))
        .output(lectureOutput)
        .mutation(async ({ ctx, input }) => {
            const userId = getUserIdFromContext(ctx);
            await ownedLecture(input.lectureId, userId);

            if (input.actIds.length > 0) {
                const acts = await db('acts').whereIn('id', input.actIds).select('id', 'owner_user_id');
                if (acts.length !== input.actIds.length) {
                    throw new DomainFailure('actNotFound', 'Act not found');
                }
                if (acts.some((act) => act.owner_user_id !== userId)) {
                    throw new DomainFailure('notOwner', 'A lecture can only contain your own acts');
                }
            }

            return db.transaction(async (trx) => {
                await trx('lecture_acts').where({ lecture_id: input.lectureId }).del();
                if (input.actIds.length > 0) {
                    await trx('lecture_acts').insert(
                        input.actIds.map((actId, position) => ({
                            lecture_id: input.lectureId,
                            act_id: actId,
                            position,
                        })),
                    );
                }

                const [updated] = await trx('lectures')
                    .where({ id: input.lectureId })
                    .update({ updated_at: new Date() })
                    .returning('*');

                return toLecture(updated);
            });
        });

export const list = () =>
    protectedProcedure
        .input(z.object({ limit: z.number().int().min(1).max(100).default(50) }))
        .output(z.array(lectureOutput))
        .query(async ({ ctx, input }) => {
            const userId = getUserIdFromContext(ctx);

            const rows = await db('lectures')
                .where((builder) => builder.whereNotNull('published_at').orWhere('owner_user_id', userId))
                .orderBy('updated_at', 'desc')
                .limit(input.limit);

            return rows.map(toLecture);
        });

export const get = () =>
    protectedProcedure
        .input(z.object({ lectureId: z.string().uuid() }))
        .output(
            z.object({
                lecture: lectureOutput,
                conceptIds: z.array(z.string()),
                actIds: z.array(z.string()),
            }),
        )
        .query(async ({ ctx, input }) => {
            const userId = getUserIdFromContext(ctx);
            const lecture = await db('lectures').where({ id: input.lectureId }).first();
            if (!lecture) {
                throw new DomainFailure('lectureNotFound', 'Lecture not found');
            }
            if (lecture.published_at === null && lecture.owner_user_id !== userId) {
                throw new DomainFailure('lectureNotFound', 'Lecture not found');
            }

            const conceptIds = await db('lecture_concepts').where({ lecture_id: input.lectureId }).pluck('concept_id');
            const actIds = await db('lecture_acts')
                .where({ lecture_id: input.lectureId })
                .orderBy('position')
                .pluck('act_id');

            return { lecture: toLecture(lecture), conceptIds, actIds };
        });

export const plan = () =>
    protectedProcedure
        .input(z.object({ lectureId: z.string().uuid() }))
        .output(
            z.object({
                jobId: z.string(),
                status: z.string(),
                plan: z.unknown(),
            }),
        )
        .mutation(async ({ ctx, input }) => {
            const job = await planLecture(db, getAi(), {
                lectureId: input.lectureId,
                userId: getUserIdFromContext(ctx),
            });
            return { jobId: job.id, status: job.status, plan: job.plan };
        });

export const generate = () =>
    protectedProcedure
        .input(z.object({ jobId: z.string().uuid(), maxUnits: z.number().int().min(1).max(40).nullable() }))
        .output(z.object({ generated: z.number().int(), failed: z.number().int() }))
        .mutation(async ({ ctx, input }) =>
            runCreationJob(db, getAi(), {
                jobId: input.jobId,
                userId: getUserIdFromContext(ctx),
                maxUnits: input.maxUnits ?? undefined,
            }),
        );

export const latestJob = () =>
    protectedProcedure
        .input(z.object({ lectureId: z.string().uuid() }))
        .output(
            z
                .object({
                    jobId: z.string(),
                    status: z.string(),
                    plan: z.unknown(),
                    error: z.string().nullable(),
                })
                .nullable(),
        )
        .query(async ({ ctx, input }) => {
            const userId = getUserIdFromContext(ctx);
            await ownedLecture(input.lectureId, userId);

            const job = await db('creation_jobs')
                .where({ lecture_id: input.lectureId })
                .orderBy('created_at', 'desc')
                .first();
            return job ? { jobId: job.id, status: job.status, plan: job.plan, error: job.error } : null;
        });

export const publish = () =>
    protectedProcedure
        .input(z.object({ lectureId: z.string().uuid() }))
        .output(lectureOutput)
        .mutation(async ({ ctx, input }) => {
            return toLecture(
                await publishLecture(db, { lectureId: input.lectureId, userId: getUserIdFromContext(ctx) }),
            );
        });
