import type { CreationJobs, Tables } from '@/types/db_schemas';
import type { Knex } from 'knex';
import type { AiProvider } from '../ai';
import { DomainFailure } from '../domainError';
import { logger } from '../logger';
import { linkConcepts } from '../graph/relations';
import { loadAgentContext, toPlanContext, type AgentContext } from './context';
import { generateActDraft } from './generate';
import { buildPlanMessages, planSchema, validatePlan, type LecturePlan } from './plan';

export type CreationResult = {
    generated: number;
    failed: number;
};

const ACTIVE_STATUSES = ['planning', 'plan_ready', 'generating'];

const loadJob = async (db: Knex<Tables>, jobId: string, userId: string): Promise<CreationJobs> => {
    const job = await db('creation_jobs').where({ id: jobId }).first();
    if (!job) {
        throw new DomainFailure('lectureNotFound', 'Creation job not found');
    }
    if (job.requested_by_user_id !== userId) {
        throw new DomainFailure('notOwner', 'Only the requester can run this job');
    }
    return job;
};

const storeProposedPrerequisites = async (db: Knex<Tables>, context: AgentContext, plan: LecturePlan) => {
    const bySlug = new Map(context.concepts.map((concept) => [concept.slug, concept.id]));

    for (const proposal of plan.proposedPrerequisites) {
        const source = bySlug.get(proposal.from);
        const target = bySlug.get(proposal.to);
        if (!source || !target || source === target) {
            continue;
        }
        try {
            await linkConcepts(db, {
                sourceConceptId: source,
                targetConceptId: target,
                type: 'requires',
                status: 'suggested',
                createdByUserId: context.lecture.owner_user_id,
            });
        } catch (error) {
            logger.warn({ proposal, error: (error as Error).message }, 'skipped proposed prerequisite');
        }
    }
};

export const planLecture = async (
    db: Knex<Tables>,
    ai: AiProvider,
    input: { lectureId: string; userId: string },
): Promise<CreationJobs> => {
    const context = await loadAgentContext(db, input.lectureId, input.userId);

    const active = await db('creation_jobs')
        .where({ lecture_id: input.lectureId })
        .whereIn('status', ACTIVE_STATUSES)
        .first();
    if (active) {
        throw new DomainFailure('creationJobActive', 'A creation job is already running for this lecture');
    }

    const [job] = await db('creation_jobs')
        .insert({ lecture_id: input.lectureId, requested_by_user_id: input.userId, status: 'planning' })
        .returning('*');

    try {
        const draft = await ai.chatStructured(buildPlanMessages(toPlanContext(context)), planSchema, {
            effort: 'high',
            maxTokens: 16000,
        });
        const plan = validatePlan(draft, toPlanContext(context));

        await storeProposedPrerequisites(db, context, plan);

        const [updated] = await db('creation_jobs')
            .where({ id: job.id })
            .update({ status: 'plan_ready', plan, updated_at: new Date() })
            .returning('*');

        return updated;
    } catch (error) {
        await db('creation_jobs')
            .where({ id: job.id })
            .update({
                status: 'failed',
                error: error instanceof Error ? error.message : String(error),
                updated_at: new Date(),
            });
        throw error;
    }
};

export const runCreationJob = async (
    db: Knex<Tables>,
    ai: AiProvider,
    input: { jobId: string; userId: string; maxUnits?: number },
): Promise<CreationResult> => {
    const job = await loadJob(db, input.jobId, input.userId);
    if (job.plan === null) {
        throw new DomainFailure('planIncomplete', 'The job has no accepted plan yet');
    }

    const context = await loadAgentContext(db, job.lecture_id, input.userId);
    const plan = planSchema.parse(job.plan);
    const units = input.maxUnits === undefined ? plan.units : plan.units.slice(0, input.maxUnits);

    await db('creation_jobs').where({ id: job.id }).update({ status: 'generating', updated_at: new Date() });

    let generated = 0;
    let failed = 0;
    const failures: string[] = [];

    for (const unit of units) {
        try {
            await generateActDraft(db, ai, context, unit);
            generated += 1;
        } catch (error) {
            failed += 1;
            failures.push(`${unit.conceptSlug}/${unit.templateKey}: ${(error as Error).message}`);
            logger.warn({ unit: unit.conceptSlug, error: (error as Error).message }, 'act generation failed');
        }
    }

    await db('creation_jobs')
        .where({ id: job.id })
        .update({
            status: failed === units.length && units.length > 0 ? 'failed' : 'completed',
            error: failures.length > 0 ? failures.join(' | ').slice(0, 2000) : null,
            updated_at: new Date(),
        });

    return { generated, failed };
};
