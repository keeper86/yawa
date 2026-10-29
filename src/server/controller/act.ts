import { z } from 'zod';
import { getAi } from '../ai';
import { embedPendingActs } from '../embed/acts';
import { baseScriptSchema } from '../templates';
import { db } from '../db';
import { DomainFailure } from '../domainError';
import { getUserIdFromContext, protectedProcedure } from '../trpcRoot';
import { actStatusSchema } from '@/types/enums';

const actColumns = [
    'acts.id',
    'acts.concept_id',
    'concepts.title as concept_title',
    'templates.key as template_key',
    'acts.template_version',
    'acts.title',
    'acts.script',
    'acts.status',
    'acts.origin',
    'acts.published_at',
    'acts.owner_user_id',
    'acts.updated_at',
] as const;

const actOutput = z.object({
    id: z.string(),
    conceptId: z.string(),
    conceptTitle: z.string(),
    templateKey: z.string(),
    templateVersion: z.number().int(),
    title: z.string(),
    script: baseScriptSchema,
    status: actStatusSchema,
    origin: z.string(),
    publishedAt: z.date().nullable(),
    ownerUserId: z.string(),
    updatedAt: z.date(),
});

type ActRow = {
    id: string;
    concept_id: string;
    concept_title: string;
    template_key: string;
    template_version: number;
    title: string;
    script: unknown;
    status: 'proposed' | 'accepted' | 'rejected';
    origin: string;
    published_at: Date | null;
    owner_user_id: string;
    updated_at: Date;
};

const toAct = (row: ActRow) => ({
    id: row.id,
    conceptId: row.concept_id,
    conceptTitle: row.concept_title,
    templateKey: row.template_key,
    templateVersion: row.template_version,
    title: row.title,
    script: baseScriptSchema.parse(row.script),
    status: row.status,
    origin: row.origin,
    publishedAt: row.published_at,
    ownerUserId: row.owner_user_id,
    updatedAt: row.updated_at,
});

const fetchAct = async (actId: string) => {
    const row = await db('acts')
        .join('concepts', 'concepts.id', 'acts.concept_id')
        .join('templates', 'templates.id', 'acts.template_id')
        .where('acts.id', actId)
        .select(...actColumns)
        .first();

    if (!row) {
        throw new DomainFailure('actNotFound', 'Act not found');
    }
    return toAct(row as ActRow);
};

export const list = () =>
    protectedProcedure
        .input(
            z.object({
                conceptId: z.string().uuid().nullable(),
                lectureId: z.string().uuid().nullable(),
                status: actStatusSchema.nullable(),
                limit: z.number().int().min(1).max(100).default(50),
            }),
        )
        .output(z.array(actOutput))
        .query(async ({ ctx, input }) => {
            const userId = getUserIdFromContext(ctx);

            const query = db('acts')
                .join('concepts', 'concepts.id', 'acts.concept_id')
                .join('templates', 'templates.id', 'acts.template_id')
                .where((builder) => builder.whereNotNull('acts.published_at').orWhere('acts.owner_user_id', userId))
                .orderBy('acts.updated_at', 'desc')
                .limit(input.limit)
                .select(...actColumns);

            if (input.lectureId !== null) {
                query
                    .join('lecture_acts', 'lecture_acts.act_id', 'acts.id')
                    .where('lecture_acts.lecture_id', input.lectureId);
            }
            if (input.conceptId !== null) {
                query.where('acts.concept_id', input.conceptId);
            }
            if (input.status !== null) {
                query.where('acts.status', input.status);
            }

            return (await query).map((row) => toAct(row as ActRow));
        });

export const get = () =>
    protectedProcedure
        .input(z.object({ actId: z.string().uuid() }))
        .output(
            z.object({
                act: actOutput,
                grounding: z.array(
                    z.object({
                        sectionId: z.string(),
                        heading: z.string(),
                        content: z.string(),
                        sourceId: z.string(),
                        sourceTitle: z.string(),
                        license: z.string(),
                        uri: z.string().nullable(),
                    }),
                ),
            }),
        )
        .query(async ({ ctx, input }) => {
            const userId = getUserIdFromContext(ctx);
            const act = await fetchAct(input.actId);
            if (act.publishedAt === null && act.ownerUserId !== userId) {
                throw new DomainFailure('actNotFound', 'Act not found');
            }

            const grounding = await db('act_grounding')
                .join('source_sections', 'source_sections.id', 'act_grounding.source_section_id')
                .join('sources', 'sources.id', 'source_sections.source_id')
                .where('act_grounding.act_id', input.actId)
                .orderBy('source_sections.position')
                .select(
                    'source_sections.id as section_id',
                    'source_sections.heading',
                    'source_sections.content',
                    'sources.id as source_id',
                    'sources.title as source_title',
                    'sources.license',
                    'sources.uri',
                );

            return {
                act,
                grounding: grounding.map((row) => ({
                    sectionId: row.section_id,
                    heading: row.heading,
                    content: row.content,
                    sourceId: row.source_id,
                    sourceTitle: row.source_title,
                    license: row.license,
                    uri: row.uri,
                })),
            };
        });

export const review = () =>
    protectedProcedure
        .input(z.object({ actId: z.string().uuid(), decision: z.enum(['accepted', 'rejected']) }))
        .output(actOutput)
        .mutation(async ({ ctx, input }) => {
            const userId = getUserIdFromContext(ctx);
            const act = await fetchAct(input.actId);

            if (act.ownerUserId !== userId) {
                throw new DomainFailure('notOwner', 'Only the owner can review this act');
            }
            if (act.publishedAt !== null) {
                throw new DomainFailure('publicationRefused', 'Published acts cannot be changed');
            }
            if (act.status === input.decision) {
                return act;
            }

            await db('acts').where({ id: input.actId }).update({
                status: input.decision,
                reviewed_by_user_id: userId,
                reviewed_at: new Date(),
                updated_at: new Date(),
            });

            return fetchAct(input.actId);
        });

export const embed = () =>
    protectedProcedure
        .input(z.object({ limit: z.number().int().min(1).max(500).default(200) }))
        .output(z.object({ embedded: z.number().int(), remaining: z.number().int() }))
        .mutation(async ({ ctx, input }) =>
            embedPendingActs(db, getAi(), { limit: input.limit, ownerUserId: getUserIdFromContext(ctx) }),
        );

export const publish = () =>
    protectedProcedure
        .input(z.object({ actId: z.string().uuid() }))
        .output(actOutput)
        .mutation(async ({ ctx, input }) => {
            const userId = getUserIdFromContext(ctx);
            const act = await fetchAct(input.actId);

            if (act.ownerUserId !== userId) {
                throw new DomainFailure('notOwner', 'Only the owner can publish this act');
            }
            if (act.publishedAt !== null) {
                return act;
            }
            if (act.status !== 'accepted') {
                throw new DomainFailure('publicationRefused', 'Only accepted acts can be published');
            }
            if (act.origin === 'generated') {
                const grounded = await db('act_grounding').where({ act_id: input.actId }).first();
                if (!grounded) {
                    throw new DomainFailure('publicationRefused', 'A generated act needs grounding before publication');
                }
            }

            const now = new Date();
            await db('acts')
                .where({ id: input.actId })
                .update({
                    published_at: now,
                    reviewed_at: db.raw('COALESCE(reviewed_at, ?)', [now]),
                    reviewed_by_user_id: db.raw('COALESCE(reviewed_by_user_id, ?)', [userId]),
                    updated_at: now,
                });

            return fetchAct(input.actId);
        });
