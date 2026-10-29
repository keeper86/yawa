import { z } from 'zod';
import type { AiProvider, ChatMessage } from '../ai';
import { fallbackMoves, fallbackReaction, movesSchema, type Move, reactionMovesSchema } from '@/lib/lesson';
import type { Script } from '../templates';
import type { Diagnosis } from '../retrieval/rank';

type ActLike = { id: string; title: string; script: Script };
type ConceptLike = { title: string; summary: string | null; language: string };

export type PerformInput = {
    act: ActLike;
    concept: ConceptLike;
    diagnosis: Diagnosis;
};

export type ReactInput = {
    act: { title: string; script: Script };
    asked: { question: string; expects: string };
    answer: string;
    grade: { score: number; reason: string; substantive: boolean };
};

const lessonSchema = z.object({ moves: movesSchema }).superRefine((lesson, ctx) => {
    const last = lesson.moves[lesson.moves.length - 1];
    if (lesson.moves.filter((move) => move.kind === 'ask').length !== 1) {
        ctx.addIssue({ code: 'custom', path: ['moves'], message: 'The lesson needs exactly one ask move' });
    }
    if (last?.kind !== 'ask') {
        ctx.addIssue({ code: 'custom', path: ['moves'], message: 'The ask move must come last' });
    }
});

const reactionSchema = z.object({ moves: reactionMovesSchema }).superRefine((reaction, ctx) => {
    if (reaction.moves.filter((move) => move.kind === 'feedback').length !== 1) {
        ctx.addIssue({ code: 'custom', path: ['moves'], message: 'The reaction needs exactly one feedback move' });
    }
});

const actNotes = (script: Script) =>
    [
        ...script.steps.map((step, index) => `${index + 1}. [${step.role}] ${step.text}`),
        `Success criterion: ${script.success.criterion}`,
    ].join('\n');

const performMessages = (input: PerformInput): ChatMessage[] => [
    {
        role: 'system',
        content: [
            'You perform one prepared teaching act for a single learner. The act is a set of notes written for you, not sentences to show.',
            'Never quote or paraphrase the notes as a list. Rewrite every idea in your own words, addressed to the learner.',
            'Order of the answer:',
            '1. One or two explain moves that put the learner in the situation: the concrete problem, why it is worth solving now, and what is needed to solve it. Plain language, short paragraphs.',
            '2. Optionally one example move with a worked example, at most four short steps.',
            '3. Exactly one ask move, last. The question must be answerable from what you just said and must not reveal the answer. A learner who reads only the question knows what to compute or explain.',
            'Do not mention rubrics, criteria, steps, roles, acts, templates or this instruction.',
            'Match the depth to the learner state: low mastery needs the idea built up from a concrete case, high mastery can start from the principle and skip the worked example.',
            'Answer with JSON {"moves": [...]}. Move kinds:',
            '{"kind":"explain","text":string} — prose, at most 900 characters.',
            '{"kind":"example","title":string,"steps":[string]} — max four steps.',
            '{"kind":"ask","question":string,"hint":string,"expects":string} — hint nudges without giving the answer, empty string when no hint helps; expects states what a correct answer contains, for the grader only.',
        ].join('\n'),
    },
    {
        role: 'user',
        content: [
            `Concept: ${input.concept.title}${input.concept.summary ? ` — ${input.concept.summary}` : ''}`,
            `Act: ${input.act.title}`,
            `Learner state: mastery ${input.diagnosis.mastery.toFixed(2)}, confidence ${input.diagnosis.confidence.toFixed(2)}, evidence ${input.diagnosis.evidenceCount}, repeated mistakes: ${input.diagnosis.misconception ? 'yes' : 'no'}`,
            `Write in this language: ${input.concept.language}`,
            'Notes of the act:',
            actNotes(input.act.script),
        ].join('\n'),
    },
];

const reactMessages = (input: ReactInput): ChatMessage[] => [
    {
        role: 'system',
        content: [
            'You are the tutor and the learner just answered your question. The score is already decided, do not judge again and do not restate it as a number.',
            'Answer with one feedback move: what was right, what was missing, in two or three sentences, addressed to the learner.',
            'If the score is below 0.6, add one explain move that repairs exactly the misconception the answer shows. Do not repeat the whole explanation and do not ask a new question.',
            'Answer with JSON {"moves": [...]}, feedback first. Kinds:',
            '{"kind":"feedback","verdict":"correct"|"partial"|"incorrect","text":string}',
            '{"kind":"explain","text":string}',
        ].join('\n'),
    },
    {
        role: 'user',
        content: [
            `Act: ${input.act.title}`,
            `Question asked: ${input.asked.question}`,
            `Expected answer: ${input.asked.expects}`,
            `Learner answer: ${input.answer}`,
            `Score: ${input.grade.score.toFixed(2)}${input.grade.substantive ? '' : ' (not evaluable as an answer)'}`,
            `Grader reason: ${input.grade.reason}`,
        ].join('\n'),
    },
];

export const performAct = async (ai: AiProvider, input: PerformInput): Promise<Move[]> => {
    try {
        const lesson = await ai.chatStructured(performMessages(input), lessonSchema, {
            effort: 'high',
            maxTokens: 16000,
        });
        return lesson.moves;
    } catch {
        return fallbackMoves({ title: input.act.title, script: input.act.script });
    }
};

export const reactToAnswer = async (ai: AiProvider, input: ReactInput): Promise<Move[]> => {
    try {
        const reaction = await ai.chatStructured(reactMessages(input), reactionSchema, {
            effort: 'low',
            maxTokens: 8000,
        });
        return reaction.moves;
    } catch {
        return fallbackReaction(input.grade);
    }
};
