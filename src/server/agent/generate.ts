import { z } from 'zod';
import { actContentHash, actText } from '@/lib/actScript';
import { toneInstruction } from '@/lib/lectureBrief';
import { getTemplateDefinition, type Script } from '../templates';
import { DomainFailure } from '../domainError';
import type { AiProvider, ChatMessage } from '../ai';
import type { Tables } from '@/types/db_schemas';
import type { Knex } from 'knex';
import type { AgentContext } from './context';
import type { PlanUnit } from './plan';

export type GeneratedAct = {
    actId: string;
    title: string;
};

const generatedSchema = (scriptSchema: z.ZodType<Script>) =>
    z.object({
        title: z.string().min(3).max(120),
        script: scriptSchema,
    });

const renderExemplar = (exemplar: { title: string; script: Script }) =>
    [
        `Titel: ${exemplar.title}`,
        ...exemplar.script.steps.map((step, index) => `${index + 1}. [${step.role}] ${step.text}`),
        `Erfolgskriterium: ${exemplar.script.success.criterion}`,
    ].join('\n');

const buildMessages = (
    context: AgentContext,
    unit: PlanUnit,
    concept: { title: string; summary: string | null },
    template: { key: string; name: string; promptFragment: string; roles: readonly string[] },
    passages: { sourceTitle: string; heading: string; content: string }[],
    exemplars: { title: string; script: Script }[],
): ChatMessage[] => {
    const objective = context.brief.objectives.find((entry) => entry.concept === unit.conceptSlug);

    return [
        {
            role: 'system',
            content: [
                'You write one teaching act as a linear script that a tutor shows to a single learner.',
                `Didactic template: ${template.name}.`,
                template.promptFragment,
                'Write in the language of the brief. Every step must be a self-contained instruction or explanation, at most 1200 characters.',
                `Use only these roles, one of them per step: ${template.roles.join(', ')}.`,
                'Ground the content in the given passages. Do not invent facts, numbers or citations that are not there.',
                'Answer with JSON: {"title": string, "script": {"steps": [{"role": string, "text": string}], "success": {"criterion": string}}}.',
            ].join('\n'),
        },
        {
            role: 'user',
            content: [
                `Concept: ${concept.title}${concept.summary ? ` — ${concept.summary}` : ''}`,
                objective
                    ? `Objective: the learner should be able to ${objective.verb} the concept: ${objective.depth}`
                    : `Audience: ${context.brief.audience}`,
                `Tone: ${context.brief.tone}. Audience: ${context.brief.audience}.`,
                toneInstruction(context.brief.language, context.brief.tone),
                'Keep that register in every step; a single informal sentence breaks it.',
                `Passages:\n${passages.map((passage) => `### ${passage.sourceTitle} / ${passage.heading}\n${passage.content}`).join('\n\n')}`,
                exemplars.length > 0
                    ? `Accepted acts of the same template, for style only — do not copy their content:\n${exemplars.map(renderExemplar).join('\n\n')}`
                    : 'There is no accepted act of this template yet.',
                unit.rationale.length > 0 ? `Planned intent: ${unit.rationale}` : '',
            ]
                .filter((part) => part.length > 0)
                .join('\n\n'),
        },
    ];
};

export const generateActDraft = async (
    db: Knex<Tables>,
    ai: AiProvider,
    context: AgentContext,
    unit: PlanUnit,
): Promise<GeneratedAct> => {
    const concept = context.concepts.find((entry) => entry.slug === unit.conceptSlug);
    if (!concept) {
        throw new DomainFailure('planIncomplete', `Unknown concept in plan: ${unit.conceptSlug}`);
    }
    const templateRow = context.templates.find((entry) => entry.key === unit.templateKey);
    if (!templateRow) {
        throw new DomainFailure('planIncomplete', `Unknown template in plan: ${unit.templateKey}`);
    }
    const definition = getTemplateDefinition(templateRow.key, templateRow.version);
    if (!definition) {
        throw new DomainFailure(
            'planIncomplete',
            `Template ${templateRow.key}@${templateRow.version} is not implemented`,
        );
    }

    const passages = unit.sourceSectionIds
        .map((id) => context.sections.find((section) => section.id === id))
        .filter((section): section is NonNullable<typeof section> => section !== undefined);
    if (passages.length === 0) {
        throw new DomainFailure('planIncomplete', `Unit for ${unit.conceptSlug} cites no usable passage`);
    }

    const exemplars = await db('acts')
        .join('templates', 'templates.id', 'acts.template_id')
        .where('templates.key', unit.templateKey)
        .where('acts.status', 'accepted')
        .orderBy('acts.reviewed_at', 'desc')
        .limit(2)
        .select('acts.title', 'acts.script');

    const output = await ai.chatStructured(
        buildMessages(
            context,
            unit,
            concept,
            {
                key: definition.key,
                name: definition.name,
                promptFragment: definition.promptFragment,
                roles: definition.roles,
            },
            passages,
            exemplars.map((exemplar) => ({ title: exemplar.title, script: exemplar.script as Script })),
        ),
        generatedSchema(definition.scriptSchema),
        { label: 'generate-act', effort: 'high', maxTokens: 16000 },
    );

    const text = actText({ title: output.title, script: output.script });
    const [act] = await db('acts')
        .insert({
            concept_id: concept.id,
            template_id: templateRow.id,
            template_version: templateRow.version,
            owner_user_id: context.lecture.owner_user_id,
            origin: 'generated',
            status: 'proposed',
            title: output.title,
            script: output.script,
            script_text: text,
            content_hash: actContentHash(text, templateRow.key, templateRow.version),
        })
        .returning('*');

    await db('act_grounding').insert(passages.map((passage) => ({ act_id: act.id, source_section_id: passage.id })));

    const lastPosition = await db('lecture_acts')
        .where({ lecture_id: context.lecture.id })
        .max<{ max: number | null }>('position as max')
        .first();
    await db('lecture_acts').insert({
        lecture_id: context.lecture.id,
        act_id: act.id,
        position: Number(lastPosition?.max ?? -1) + 1,
    });

    return { actId: act.id, title: act.title };
};
