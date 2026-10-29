import { type Bead, fallbackLesson, fallbackRepair, type Lesson, lessonSchema, repairSchema } from '@/lib/lesson';
import type { AiProvider, ChatMessage } from '../ai';
import type { Script } from '../templates';
import type { Diagnosis } from '../retrieval/rank';

type ActLike = { id: string; title: string; script: Script };
type ConceptLike = { title: string; summary: string | null; language: string };

export type PlanInput = {
    act: ActLike;
    concept: ConceptLike;
    diagnosis: Diagnosis;
};

export type RepairInput = {
    bead: Bead;
    chosen: { text: string; why: string };
    attempt: number;
};

const strictLessonSchema = lessonSchema.superRefine((lesson, ctx) => {
    lesson.beads.forEach((bead, index) => {
        if (bead.kind !== 'choice') {
            return;
        }
        if (bead.options.filter((option) => option.correct).length !== 1) {
            ctx.addIssue({
                code: 'custom',
                path: ['beads', index],
                message: 'A choice bead needs exactly one correct option',
            });
        }
        if (bead.options.some((option) => !option.correct && option.why.trim().length === 0)) {
            ctx.addIssue({ code: 'custom', path: ['beads', index], message: 'Every wrong option needs a why' });
        }
    });
});

const actNotes = (script: Script) =>
    [
        ...script.steps.map((step, index) => `${index + 1}. [${step.role}] ${step.text}`),
        `Success criterion: ${script.success.criterion}`,
    ].join('\n');

const planMessages = (input: PlanInput): ChatMessage[] => [
    {
        role: 'system',
        content: [
            'You design a short interactive lesson for one learner. You never write a page of text, you write beads.',
            'One bead is one idea, at most 450 characters, followed by one check the learner answers by picking an option.',
            'Take these beads in this order, three to five in total:',
            'anchor — the concrete situation the learner already understands, and the question it raises.',
            'idea — the one causal mechanism that answers it. This is the bead that matters.',
            'example — the same idea carried out with concrete numbers.',
            'contrast — the tempting wrong model and exactly why it fails. Wrong options belong here.',
            'transfer — the same idea on new numbers or on a neighbouring method.',
            'Rules:',
            'The check of a bead is answerable from the ideas of this bead and the beads before it, never from later beads.',
            'Never give the answer to a check inside its own idea.',
            'Every option is a mistake a real learner makes. why names that mistake in one short clause. No joke options, no "all of the above", no options that differ only in wording.',
            `Write in this language: ${input.concept.language}.`,
            'The act notes are written for you, not for the learner. Rewrite them, never quote them.',
            'Answer with JSON {"beads": [...]}. A bead is either',
            '{"kind":"choice","idea":string,"question":string,"options":[{"text":string,"correct":boolean,"why":string}]}',
            'or, only as the last bead when the act demands a written answer,',
            '{"kind":"open","idea":string,"question":string,"expects":string}.',
        ].join('\n'),
    },
    {
        role: 'user',
        content: [
            `Concept: ${input.concept.title}${input.concept.summary ? ` — ${input.concept.summary}` : ''}`,
            `Act: ${input.act.title}`,
            `Learner state: mastery ${input.diagnosis.mastery.toFixed(2)}, confidence ${input.diagnosis.confidence.toFixed(2)}, evidence ${input.diagnosis.evidenceCount}, repeated mistakes: ${input.diagnosis.misconception ? 'yes' : 'no'}`,
            'Notes of the act:',
            actNotes(input.act.script),
        ].join('\n'),
    },
];

const repairMessages = (input: RepairInput): ChatMessage[] => [
    {
        role: 'system',
        content: [
            'The learner picked a wrong option. Name the mistake in one clause, then explain the same idea in another way so the next attempt becomes possible.',
            'At most three sentences. Do not name the correct option. Do not repeat the wording of the idea.',
            'Answer with JSON {"text": string}.',
        ].join('\n'),
    },
    {
        role: 'user',
        content: [
            `Idea of the bead: ${input.bead.idea}`,
            `Question: ${input.bead.question}`,
            `Chosen option: ${input.chosen.text}`,
            `Mistake it reveals: ${input.chosen.why}`,
            `Attempt: ${input.attempt}`,
        ].join('\n'),
    },
];

export const planLesson = async (ai: AiProvider, input: PlanInput): Promise<Lesson> => {
    try {
        return await ai.chatStructured(planMessages(input), strictLessonSchema, { effort: 'high', maxTokens: 16000 });
    } catch {
        return fallbackLesson({ title: input.act.title, script: input.act.script });
    }
};

export const repairBead = async (ai: AiProvider, input: RepairInput): Promise<string> => {
    try {
        const repair = await ai.chatStructured(repairMessages(input), repairSchema, { effort: 'low', maxTokens: 8000 });
        return repair.text;
    } catch {
        return fallbackRepair({ why: input.chosen.why, idea: input.bead.idea });
    }
};
