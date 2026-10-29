import { z } from 'zod';

type ActScript = {
    steps: { role: string; text: string }[];
    success: { criterion: string };
};

export const explainMoveSchema = z.object({
    kind: z.literal('explain'),
    text: z.string().min(1).max(1200),
});

export const exampleMoveSchema = z.object({
    kind: z.literal('example'),
    title: z.string().min(1).max(120),
    steps: z.array(z.string().min(1).max(600)).min(1).max(6),
});

export const askMoveSchema = z.object({
    kind: z.literal('ask'),
    question: z.string().min(1).max(800),
    hint: z.string().max(400),
    expects: z.string().min(1).max(400),
});

export const feedbackMoveSchema = z.object({
    kind: z.literal('feedback'),
    verdict: z.enum(['correct', 'partial', 'incorrect']),
    text: z.string().min(1).max(1200),
});

export const moveSchema = z.discriminatedUnion('kind', [
    explainMoveSchema,
    exampleMoveSchema,
    askMoveSchema,
    feedbackMoveSchema,
]);

export const movesSchema = z.array(moveSchema).min(1).max(8);

export const reactionMovesSchema = z
    .array(z.union([feedbackMoveSchema, explainMoveSchema]))
    .min(1)
    .max(3);

export type Move = z.infer<typeof moveSchema>;
export type FeedbackMove = z.infer<typeof feedbackMoveSchema>;
export type AskMove = z.infer<typeof askMoveSchema>;

export const findAsk = (moves: Move[]): AskMove | null => {
    const ask = moves.find((move) => move.kind === 'ask');
    return ask ?? null;
};

export const verdictFor = (score: number): FeedbackMove['verdict'] => {
    if (score >= 0.75) {
        return 'correct';
    }
    return score >= 0.4 ? 'partial' : 'incorrect';
};

export const fallbackMoves = (act: { title: string; script: ActScript }): Move[] => {
    const checkIndex = act.script.steps.findIndex((step) => step.role === 'check');
    const taught = act.script.steps.filter((_, index) => index !== checkIndex);
    const askSource = act.script.steps[checkIndex] ?? act.script.steps[act.script.steps.length - 1];

    const moves: Move[] = [];
    const [first, ...rest] = taught;
    if (first) {
        moves.push({ kind: 'explain', text: first.text });
    }
    if (rest.length > 0) {
        moves.push({ kind: 'example', title: act.title, steps: rest.slice(0, 6).map((step) => step.text) });
    }
    if (askSource) {
        moves.push({
            kind: 'ask',
            question: askSource.text,
            hint: '',
            expects: act.script.success.criterion,
        });
    }
    return moves;
};

export const fallbackReaction = (input: { score: number; reason: string }): Move[] => [
    { kind: 'feedback', verdict: verdictFor(input.score), text: input.reason },
];
