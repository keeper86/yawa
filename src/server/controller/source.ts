import { z } from 'zod';
import { pasteExternalId, splitSections } from '@/lib/sourceText';
import type { Sources } from '@/types/db_schemas';
import { db } from '../db';
import { DomainFailure } from '../domainError';
import { getUserIdFromContext, protectedProcedure } from '../trpcRoot';

const sourceOutput = z.object({
    id: z.string(),
    title: z.string(),
    language: z.string(),
    license: z.string(),
    licenseUrl: z.string().nullable(),
    sectionCount: z.number().int(),
    createdAt: z.date(),
});

const toSource = (row: Sources, sectionCount: number) => ({
    id: row.id,
    title: row.title,
    language: row.language,
    license: row.license,
    licenseUrl: row.license_url,
    sectionCount,
    createdAt: row.created_at,
});

const ownedLecture = async (lectureId: string, userId: string) => {
    const lecture = await db('lectures').where({ id: lectureId }).first();
    if (!lecture) {
        throw new DomainFailure('lectureNotFound', 'Lecture not found');
    }
    if (lecture.owner_user_id !== userId) {
        throw new DomainFailure('notOwner', 'Only the owner can change this');
    }
    return lecture;
};

export const addText = () =>
    protectedProcedure
        .input(
            z.object({
                lectureId: z.string().uuid(),
                title: z.string().trim().min(1).max(200),
                text: z.string().trim().min(20).max(200_000),
                language: z.string().min(2).max(8),
            }),
        )
        .output(sourceOutput)
        .mutation(async ({ ctx, input }) => {
            const userId = getUserIdFromContext(ctx);
            await ownedLecture(input.lectureId, userId);

            const sections = splitSections(input.text);
            if (sections.length === 0) {
                throw new DomainFailure('invalidBrief', 'The text contains no usable sections');
            }

            return await db.transaction(async (trx) => {
                const externalId = pasteExternalId(input.text);
                const existing = await trx('sources').where({ owner_user_id: userId, external_id: externalId }).first();

                const source =
                    existing ??
                    (
                        await trx('sources')
                            .insert({
                                owner_user_id: userId,
                                kind: 'paste',
                                external_id: externalId,
                                title: input.title,
                                language: input.language,
                                license: 'own-work',
                                uri: null,
                                license_url: null,
                                source_revision: null,
                                fetched_at: null,
                            })
                            .returning('*')
                    )[0];

                if (!existing) {
                    await trx('source_sections').insert(
                        sections.map((section, position) => ({
                            source_id: source.id,
                            position,
                            heading: section.heading,
                            anchor: null,
                            content: section.content,
                            content_hash: section.contentHash,
                        })),
                    );
                }

                await trx('lecture_sources')
                    .insert({ lecture_id: input.lectureId, source_id: source.id })
                    .onConflict()
                    .ignore();

                const stored = await trx('source_sections')
                    .where({ source_id: source.id })
                    .count<{ count: string }>('* as count')
                    .first();

                return toSource(source, Number(stored?.count ?? sections.length));
            });
        });

export const list = () =>
    protectedProcedure
        .input(z.object({ lectureId: z.string().uuid() }))
        .output(z.array(sourceOutput))
        .query(async ({ ctx, input }) => {
            const userId = getUserIdFromContext(ctx);
            await ownedLecture(input.lectureId, userId);

            const rows = await db('lecture_sources')
                .join('sources', 'sources.id', 'lecture_sources.source_id')
                .where('lecture_sources.lecture_id', input.lectureId)
                .select('sources.*');

            const counts = await db('source_sections')
                .whereIn(
                    'source_id',
                    rows.map((row) => row.id),
                )
                .groupBy('source_id')
                .select('source_id')
                .count<{ source_id: string; count: string }[]>('* as count');

            const bySource = new Map(counts.map((entry) => [entry.source_id, Number(entry.count)]));
            return rows.map((row) => toSource(row, bySource.get(row.id) ?? 0));
        });

export const remove = () =>
    protectedProcedure
        .input(z.object({ sourceId: z.string().uuid() }))
        .output(z.object({ sourceId: z.string() }))
        .mutation(async ({ ctx, input }) => {
            const userId = getUserIdFromContext(ctx);
            const source = await db('sources').where({ id: input.sourceId }).first();
            if (!source) {
                throw new DomainFailure('sourceNotFound', 'Source not found');
            }
            if (source.owner_user_id !== userId) {
                throw new DomainFailure('notOwner', 'Only the owner can change this');
            }

            const grounded = await db('act_grounding')
                .join('source_sections', 'source_sections.id', 'act_grounding.source_section_id')
                .where('source_sections.source_id', input.sourceId)
                .first();

            if (grounded) {
                throw new DomainFailure('sourceInUse', 'This source is used as grounding by at least one act');
            }

            await db('sources').where({ id: input.sourceId }).del();
            return { sourceId: input.sourceId };
        });
