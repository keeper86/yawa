import { z } from 'zod';
import type { LectureBrief } from '@/lib/lectureBrief';
import { DomainFailure } from '../domainError';

export const planUnitSchema = z.object({
    conceptSlug: z.string().min(1),
    templateKey: z.string().min(1),
    order: z.number().int().min(0),
    rationale: z.string().min(1).max(1000),
    sourceSectionIds: z.array(z.string().min(1)).min(1).max(6),
});

export const planSchema = z.object({
    units: z.array(planUnitSchema).min(1).max(40),
    proposedPrerequisites: z.array(z.object({ from: z.string(), to: z.string() })).max(20),
});

export type LecturePlan = z.infer<typeof planSchema>;
export type PlanUnit = z.infer<typeof planUnitSchema>;

export type PlanContext = {
    brief: LectureBrief;
    concepts: { slug: string; title: string; summary: string | null }[];
    prerequisites: string[];
    templates: { key: string; intent: string; trigger: string }[];
    sections: { id: string; sourceTitle: string; heading: string; preview: string }[];
};

const MINUTES_PER_UNIT = 10;

export const buildPlanMessages = (context: PlanContext) => [
    {
        role: 'system' as const,
        content: [
            'You plan a lecture as a sequence of teaching acts. Each act teaches exactly one concept with exactly one didactic template.',
            'You do not write the acts; you decide which concept is taught with which template, in which order, and from which source passages.',
            'Pick a template by its trigger, not by preference. Pick one to six passages per unit, and only passages that actually contain what the act needs.',
            'The rationale is one or two sentences: why this template for this concept, in this position.',
            'If the brief demands a concept that the passages cannot support, still include it and choose the passages closest to it.',
            'Answer in JSON.',
        ].join('\n'),
    },
    {
        role: 'user' as const,
        content: [
            `Brief:\n${JSON.stringify(context.brief, null, 2)}`,
            `Concepts in scope:\n${context.concepts.map((concept) => `- ${concept.slug}: ${concept.title}${concept.summary ? ` — ${concept.summary}` : ''}`).join('\n')}`,
            context.prerequisites.length > 0
                ? `Prerequisites of these concepts (context only, do not teach them):\n${context.prerequisites.join(', ')}`
                : 'No prerequisites are known for these concepts.',
            `Templates:\n${context.templates.map((template) => `- ${template.key}: ${template.intent} Trigger: ${template.trigger}`).join('\n')}`,
            `Source passages:\n${context.sections.map((section) => `- id ${section.id} | ${section.sourceTitle} / ${section.heading}: ${section.preview}`).join('\n')}`,
            'Return {"units":[{"conceptSlug","templateKey","order","rationale","sourceSectionIds"}],"proposedPrerequisites":[{"from","to"}]}.',
        ].join('\n\n'),
    },
];

export const validatePlan = (plan: LecturePlan, context: PlanContext): LecturePlan => {
    const allowedConcepts = new Set(context.concepts.map((concept) => concept.slug));
    const allowedTemplates = new Set(context.templates.map((template) => template.key));
    const allowedSections = new Set(context.sections.map((section) => section.id));
    const avoided = new Set(context.brief.mustAvoid.map((entry) => entry.toLowerCase()));

    const unknownConcept = plan.units.find((unit) => !allowedConcepts.has(unit.conceptSlug));
    if (unknownConcept) {
        throw new DomainFailure(
            'planIncomplete',
            `Plan teaches a concept outside the scope: ${unknownConcept.conceptSlug}`,
        );
    }

    const unknownTemplate = plan.units.find((unit) => !allowedTemplates.has(unit.templateKey));
    if (unknownTemplate) {
        throw new DomainFailure('planIncomplete', `Plan uses an unknown template: ${unknownTemplate.templateKey}`);
    }

    const unknownSection = plan.units.find((unit) => unit.sourceSectionIds.some((id) => !allowedSections.has(id)));
    if (unknownSection) {
        throw new DomainFailure('planIncomplete', 'Plan cites a passage that is not part of this lecture');
    }

    const covered = new Set(plan.units.map((unit) => unit.conceptSlug));
    const missing = context.brief.mustCover.filter((slug) => !covered.has(slug));
    if (missing.length > 0) {
        throw new DomainFailure('planIncomplete', `Plan misses required concepts: ${missing.join(', ')}`);
    }

    const teachesAvoided = plan.units.find((unit) => avoided.has(unit.conceptSlug.toLowerCase()));
    if (teachesAvoided) {
        throw new DomainFailure('planIncomplete', `Plan teaches an excluded concept: ${teachesAvoided.conceptSlug}`);
    }

    const budget = Math.round(context.brief.durationMinutes / MINUTES_PER_UNIT);
    const upper = Math.max(1, Math.round(budget * 1.5));
    if (plan.units.length > upper) {
        throw new DomainFailure(
            'planIncomplete',
            `Plan has ${plan.units.length} units for a ${context.brief.durationMinutes} minute lecture (at most ${upper})`,
        );
    }

    return { ...plan, units: [...plan.units].sort((left, right) => left.order - right.order) };
};
