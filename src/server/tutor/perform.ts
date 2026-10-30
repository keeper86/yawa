import {
    type Bead,
    fallbackLesson,
    fallbackRepair,
    type Figure,
    type Lesson,
    lessonSchema,
    repairSchema,
} from '@/lib/lesson';
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
            'Figures: prefer a chart to a bare number. When a bead compares two values, sweeps a parameter, shows a trend over three or more points, or shows a before and after, draw it - a chart that adds little costs the learner a glance, a missing one costs them the insight.',
            'When you are unsure whether a figure helps, draw it. But do not chart a bead just because it mentions a number: one or two beads per lesson carry the argument, and those are the ones to draw.',
            'Use the numbers of the bead idea or of the act notes and never invent measurements; if the idea has no numbers yet, put the two or three the figure needs into the idea as well.',
            'figure, form A: {"template":"trend"|"scatter","x":{"label":string,"unit":string},"y":{"label":string,"unit":string},"caption":string,"series":[{"label":string,"points":[{"x":number,"y":number}]}]}',
            'figure, form B: {"template":"compare","y":{"label":string,"unit":string},"caption":string,"categories":[string],"series":[{"label":string,"values":[number]}]} with one value per category and two to eight categories.',
            'trend draws a line over a numeric axis, scatter draws individual measurements, compare draws bars over named categories - put the category names in categories, never in an axis label. label names the quantity, unit carries its unit and a dimensionless quantity gets 1.',
            'At most twelve points per series and at most two series. The caption says what the learner should look at, not what the chart is.',
            'Example figure A: {"template":"trend","x":{"label":"Schrittweite h","unit":"m"},"y":{"label":"Fehler","unit":"m^3"},"caption":"Halbieren von h viertelt den Fehler.","series":[{"label":"Trapez","points":[{"x":0.4,"y":0.08},{"x":0.2,"y":0.02}]}]}',
            'Example figure B: {"template":"compare","y":{"label":"Naeherung","unit":"1"},"caption":"Linke Summe liegt unter dem exakten Wert.","categories":["linke Summe","exakt"],"series":[{"label":"x^2 auf [0,1]","values":[0.25,0.3333]}]}',
            'Answer with JSON {"beads": [...]}. A bead is either',
            '{"kind":"choice","idea":string,"question":string,"figure":object|null,"options":[{"text":string,"correct":boolean,"why":string}]}',
            'or, only as the last bead when the act demands a written answer,',
            '{"kind":"open","idea":string,"question":string,"figure":object|null,"expects":string}.',
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

const usableFigure = (figure: Figure | null): Figure | null => {
    if (figure === null) {
        return null;
    }

    if (figure.template === 'compare') {
        const aligned = figure.series.every((series) => series.values.length === figure.categories.length);
        return aligned ? figure : null;
    }

    for (const series of figure.series) {
        const distinct = new Set(series.points.map((point) => point.x));
        if (distinct.size !== series.points.length) {
            return null;
        }
    }
    return figure;
};

const sanitizeBead = (bead: Bead): Bead => {
    const figure = usableFigure(bead.figure);
    if (bead.kind === 'choice') {
        return { kind: 'choice', idea: bead.idea, question: bead.question, options: bead.options, figure };
    }
    return { kind: 'open', idea: bead.idea, question: bead.question, expects: bead.expects, figure };
};

export type PlanOutcome = { lesson: Lesson; fromModel: boolean };

export const planLessonOutcome = async (ai: AiProvider, input: PlanInput): Promise<PlanOutcome> => {
    try {
        const lesson = await ai.chatStructured(planMessages(input), strictLessonSchema, {
            label: 'plan-lesson',
            effort: 'high',
            maxTokens: 16000,
        });
        return { lesson: { beads: lesson.beads.map(sanitizeBead) }, fromModel: true };
    } catch {
        return { lesson: fallbackLesson({ title: input.act.title, script: input.act.script }), fromModel: false };
    }
};

export const planLesson = async (ai: AiProvider, input: PlanInput): Promise<Lesson> =>
    (await planLessonOutcome(ai, input)).lesson;

export const repairBead = async (ai: AiProvider, input: RepairInput): Promise<string> => {
    try {
        const repair = await ai.chatStructured(repairMessages(input), repairSchema, {
            label: 'repair-bead',
            effort: 'low',
            maxTokens: 8000,
        });
        return repair.text;
    } catch {
        return fallbackRepair({ why: input.chosen.why, idea: input.bead.idea });
    }
};
