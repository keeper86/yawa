import { z } from 'zod';
import { db } from '../db';
import { DomainFailure } from '../domainError';
import { resolveConcept } from '../concept/resolve';
import { linkConcepts } from '../graph/relations';
import { getUserIdFromContext, protectedProcedure } from '../trpcRoot';
import { relationTypeSchema } from '@/types/enums';
import type { Concepts } from '@/types/db_schemas';

const conceptOutput = z.object({
    id: z.string(),
    slug: z.string(),
    title: z.string(),
    language: z.string(),
    summary: z.string().nullable(),
    wikidataQid: z.string().nullable(),
});

const relationOutput = z.object({
    id: z.string(),
    type: relationTypeSchema,
    status: z.string(),
    direction: z.enum(['outgoing', 'incoming']),
    neighbourId: z.string(),
    neighbourTitle: z.string(),
});

const toConcept = (row: Concepts) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    language: row.language,
    summary: row.summary,
    wikidataQid: row.wikidata_qid,
});

export const resolve = () =>
    protectedProcedure
        .input(
            z.object({
                title: z.string().trim().min(1).max(200),
                language: z.string().min(2).max(8),
                summary: z.string().max(2000).nullable(),
                wikidataQid: z.string().max(32).nullable(),
            }),
        )
        .output(conceptOutput)
        .mutation(async ({ ctx, input }) => {
            return toConcept(
                await resolveConcept(db, {
                    title: input.title,
                    language: input.language,
                    summary: input.summary,
                    wikidataQid: input.wikidataQid,
                    createdByUserId: getUserIdFromContext(ctx),
                }),
            );
        });

export const search = () =>
    protectedProcedure
        .input(
            z.object({
                query: z.string().trim().min(2).max(120),
                language: z.string().min(2).max(8),
                limit: z.number().int().min(1).max(50).default(10),
            }),
        )
        .output(z.array(conceptOutput))
        .query(async ({ input }) => {
            const rows = await db('concepts')
                .where({ language: input.language })
                .whereRaw('immutable_unaccent(lower(title)) LIKE immutable_unaccent(lower(?))', [`%${input.query}%`])
                .orderBy('title')
                .limit(input.limit);

            return rows.map(toConcept);
        });

export const get = () =>
    protectedProcedure
        .input(z.object({ conceptId: z.string().uuid() }))
        .output(z.object({ concept: conceptOutput, relations: z.array(relationOutput) }))
        .query(async ({ input }) => {
            const concept = await db('concepts').where({ id: input.conceptId }).first();
            if (!concept) {
                throw new DomainFailure('conceptNotFound', 'Concept not found');
            }

            const rows = await db('concept_relations')
                .join('concepts as source', 'source.id', 'concept_relations.source_concept_id')
                .join('concepts as target', 'target.id', 'concept_relations.target_concept_id')
                .where((builder) =>
                    builder
                        .where('concept_relations.source_concept_id', input.conceptId)
                        .orWhere('concept_relations.target_concept_id', input.conceptId),
                )
                .whereNot('concept_relations.status', 'rejected')
                .select(
                    'concept_relations.id',
                    'concept_relations.type',
                    'concept_relations.status',
                    'concept_relations.source_concept_id',
                    'source.title as source_title',
                    'concept_relations.target_concept_id',
                    'target.title as target_title',
                );

            const relations = rows.map((row) => {
                const outgoing = row.source_concept_id === input.conceptId;
                return {
                    id: row.id,
                    type: row.type,
                    status: row.status,
                    direction: outgoing ? ('outgoing' as const) : ('incoming' as const),
                    neighbourId: outgoing ? row.target_concept_id : row.source_concept_id,
                    neighbourTitle: outgoing ? row.target_title : row.source_title,
                };
            });

            return { concept: toConcept(concept), relations };
        });

export const link = () =>
    protectedProcedure
        .input(
            z
                .object({
                    sourceConceptId: z.string().uuid(),
                    targetConceptId: z.string().uuid(),
                    type: relationTypeSchema,
                    status: z.enum(['suggested', 'published']).default('suggested'),
                })
                .refine((value) => value.sourceConceptId !== value.targetConceptId, {
                    message: 'A concept cannot be related to itself',
                    path: ['targetConceptId'],
                }),
        )
        .output(z.object({ relationId: z.string(), created: z.boolean() }))
        .mutation(async ({ ctx, input }) => {
            const { relation, created } = await linkConcepts(db, {
                sourceConceptId: input.sourceConceptId,
                targetConceptId: input.targetConceptId,
                type: input.type,
                status: input.status,
                createdByUserId: getUserIdFromContext(ctx),
            });
            return { relationId: relation.id, created };
        });

export const unlink = () =>
    protectedProcedure
        .input(z.object({ relationId: z.string().uuid() }))
        .output(z.object({ relationId: z.string(), status: z.string() }))
        .mutation(async ({ ctx, input }) => {
            const userId = getUserIdFromContext(ctx);
            const relation = await db('concept_relations').where({ id: input.relationId }).first();
            if (!relation) {
                throw new DomainFailure('conceptNotFound', 'Relation not found');
            }
            if (relation.created_by_user_id !== userId) {
                throw new DomainFailure('notOwner', 'Only the creator of a relation can retire it');
            }

            const [updated] = await db('concept_relations')
                .where({ id: input.relationId })
                .update({ status: 'rejected' })
                .returning('*');

            return { relationId: updated.id, status: updated.status };
        });
