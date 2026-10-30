import { z } from 'zod';
import type { AiProvider } from '../ai';
import { logger } from '../logger';

export type Grade = {
    score: number;
    substantive: boolean;
    reason: string;
};

const gradeSchema = z.object({
    score: z.number().min(0).max(1),
    substantive: z.boolean(),
    reason: z.string().min(1).max(300),
});

const FALLBACK: Grade = { score: 0.5, substantive: false, reason: 'Die Antwort konnte nicht bewertet werden.' };

export const gradeAnswer = async (ai: AiProvider, input: { criterion: string; answer: string }): Promise<Grade> => {
    try {
        return await ai.chatStructured(
            [
                {
                    role: 'system',
                    content: [
                        'You grade a learner answer against a success criterion.',
                        'Score the evidence in the answer, not its politeness or length. 1 means the criterion is met, 0 means nothing relevant is there.',
                        'Set substantive to true only when the answer engages the actual concept, even if it is wrong.',
                        'Answer in JSON with score (0..1), substantive (boolean) and reason (max 300 characters).',
                    ].join('\n'),
                },
                {
                    role: 'user',
                    content: `Erfolgskriterium: ${input.criterion}\n\nAntwort der lernenden Person: ${input.answer}`,
                },
            ],
            gradeSchema,
            { label: 'grade-answer', effort: 'low', maxTokens: 1024 },
        );
    } catch (error) {
        logger.warn({ error: (error as Error).message }, 'grading failed, recording a neutral outcome');
        return FALLBACK;
    }
};
