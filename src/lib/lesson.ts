import { z } from 'zod';

type ActScript = {
    steps: { role: string; text: string }[];
    success: { criterion: string };
};

export const optionSchema = z.object({
    text: z.string().min(1).max(300),
    correct: z.boolean(),
    why: z.string().max(300),
});

export const figurePointSchema = z.object({
    x: z.number().finite(),
    y: z.number().finite(),
});

export const figureSeriesSchema = z.object({
    label: z.string().min(1).max(60),
    points: z.array(figurePointSchema).min(2).max(40),
});

export const figureSchema = z.object({
    kind: z.enum(['line', 'bar', 'scatter']),
    xLabel: z.string().min(1).max(60),
    yLabel: z.string().min(1).max(60),
    caption: z.string().min(1).max(300),
    series: z.array(figureSeriesSchema).min(1).max(3),
});

export const choiceBeadSchema = z.object({
    kind: z.literal('choice'),
    idea: z.string().min(1).max(600),
    question: z.string().min(1).max(400),
    figure: figureSchema.nullable().default(null),
    options: z.array(optionSchema).min(3).max(4),
});

export const openBeadSchema = z.object({
    kind: z.literal('open'),
    idea: z.string().min(1).max(600),
    question: z.string().min(1).max(400),
    figure: figureSchema.nullable().default(null),
    expects: z.string().min(1).max(400),
});

export const beadSchema = z.discriminatedUnion('kind', [choiceBeadSchema, openBeadSchema]);

export const beadsSchema = z.array(beadSchema).min(1).max(6);

export const lessonSchema = z.object({ beads: beadsSchema });

export const repairSchema = z.object({
    text: z.string().min(1).max(800),
});

export type Option = z.infer<typeof optionSchema>;
export type ChoiceBead = z.infer<typeof choiceBeadSchema>;
export type OpenBead = z.infer<typeof openBeadSchema>;
export type Figure = z.infer<typeof figureSchema>;
export type FigureSeries = z.infer<typeof figureSeriesSchema>;
export type Bead = z.infer<typeof beadSchema>;
export type Lesson = z.infer<typeof lessonSchema>;

export const correctOption = (bead: ChoiceBead): number => bead.options.findIndex((option) => option.correct);

export const creditFor = (input: { correct: boolean; attempts: number; revealed: boolean }): number => {
    if (input.revealed) {
        return 0.15;
    }
    if (!input.correct) {
        return 0;
    }
    return input.attempts === 1 ? 1 : 0.6;
};

export const fallbackLesson = (act: { title: string; script: ActScript }): Lesson => {
    const taught = act.script.steps.filter((step) => step.role !== 'check');
    const check = act.script.steps.find((step) => step.role === 'check');

    return {
        beads: [
            {
                kind: 'open',
                idea: taught[0]?.text ?? act.title,
                question: check?.text ?? act.title,
                figure: null,
                expects: act.script.success.criterion,
            },
        ],
    };
};

export const fallbackRepair = (input: { why: string; idea: string }): string =>
    input.why.trim().length > 0 ? input.why : input.idea;
