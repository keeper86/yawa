import { briefSchema, type LectureBrief } from '@/lib/lectureBrief';
import type { Lectures, Tables } from '@/types/db_schemas';
import type { Knex } from 'knex';
import { DomainFailure } from '../domainError';
import { prerequisiteClosure } from '../graph/traversal';
import type { PlanContext } from './plan';

export type AgentContext = {
    lecture: Lectures;
    brief: LectureBrief;
    concepts: { id: string; slug: string; title: string; summary: string | null }[];
    sections: { id: string; sourceTitle: string; heading: string; content: string }[];
    templates: { id: string; key: string; version: number; name: string; intent: string; trigger: string }[];
    prerequisites: string[];
};

const SECTION_PREVIEW_LENGTH = 200;

export const loadAgentContext = async (db: Knex<Tables>, lectureId: string, userId: string): Promise<AgentContext> => {
    const lecture = await db('lectures').where({ id: lectureId }).first();
    if (!lecture) {
        throw new DomainFailure('lectureNotFound', 'Lecture not found');
    }
    if (lecture.owner_user_id !== userId) {
        throw new DomainFailure('notOwner', 'Only the owner can create acts for this lecture');
    }

    const parsedBrief = briefSchema.safeParse(lecture.brief);
    if (!parsedBrief.success) {
        const fields = parsedBrief.error.issues.map((issue) => issue.path.join('.')).join(', ');
        throw new DomainFailure('invalidBrief', `Brief is invalid: ${fields}`);
    }

    const concepts = await db('lecture_concepts')
        .join('concepts', 'concepts.id', 'lecture_concepts.concept_id')
        .where('lecture_concepts.lecture_id', lectureId)
        .select('concepts.id', 'concepts.slug', 'concepts.title', 'concepts.summary');

    if (concepts.length === 0) {
        throw new DomainFailure('invalidBrief', 'The lecture has no concepts in scope');
    }

    const sections = await db('lecture_sources')
        .join('source_sections', 'source_sections.source_id', 'lecture_sources.source_id')
        .join('sources', 'sources.id', 'lecture_sources.source_id')
        .where('lecture_sources.lecture_id', lectureId)
        .orderBy('source_sections.position')
        .select(
            'source_sections.id',
            'sources.title as source_title',
            'source_sections.heading',
            'source_sections.content',
        );

    if (sections.length === 0) {
        throw new DomainFailure('invalidBrief', 'The lecture has no source passages in scope');
    }

    const templates = await db('templates')
        .where({ status: 'active' })
        .orderBy('key')
        .select('id', 'key', 'version', 'name', 'intent', 'trigger');

    const closure = await prerequisiteClosure(
        db,
        concepts.map((concept) => concept.id),
        { depth: 2, statuses: ['published'] },
    );
    const prerequisites =
        closure.size === 0
            ? []
            : await db('concepts')
                  .whereIn('id', [...closure.keys()])
                  .pluck('title');

    return {
        lecture,
        brief: parsedBrief.data,
        concepts: concepts.map((concept) => ({
            id: concept.id,
            slug: concept.slug,
            title: concept.title,
            summary: concept.summary,
        })),
        sections: sections.map((section) => ({
            id: section.id,
            sourceTitle: section.source_title,
            heading: section.heading,
            content: section.content,
        })),
        templates: templates.map((template) => ({
            id: template.id,
            key: template.key,
            version: template.version,
            name: template.name,
            intent: template.intent,
            trigger: template.trigger,
        })),
        prerequisites,
    };
};

export const toPlanContext = (context: AgentContext): PlanContext => ({
    brief: context.brief,
    concepts: context.concepts.map((concept) => ({
        slug: concept.slug,
        title: concept.title,
        summary: concept.summary,
    })),
    prerequisites: context.prerequisites,
    templates: context.templates.map((template) => ({
        key: template.key,
        intent: template.intent,
        trigger: template.trigger,
    })),
    sections: context.sections.map((section) => ({
        id: section.id,
        sourceTitle: section.sourceTitle,
        heading: section.heading,
        preview: section.content.slice(0, SECTION_PREVIEW_LENGTH),
    })),
});
