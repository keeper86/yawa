import { z } from 'zod';

export const observableVerbs = ['explain', 'apply', 'compare', 'estimate', 'derive', 'classify'] as const;

export const objectiveSchema = z.object({
    concept: z.string().min(1).max(120),
    verb: z.enum(observableVerbs),
    depth: z.string().min(1).max(300),
});

export const briefSchema = z.object({
    audience: z.string().min(1).max(200),
    objectives: z.array(objectiveSchema).min(1).max(20),
    mustCover: z.array(z.string().min(1).max(120)).max(30),
    mustAvoid: z.array(z.string().min(1).max(120)).max(30),
    durationMinutes: z.number().int().min(15).max(600),
    tone: z.enum(['formal', 'neutral', 'conversational']),
    language: z.enum(['de', 'en']),
    notes: z.string().max(2000),
});

export type LectureBrief = z.infer<typeof briefSchema>;

export const toneInstruction = (language: LectureBrief['language'], tone: LectureBrief['tone']): string => {
    if (language === 'de') {
        if (tone === 'formal') {
            return 'Sprich die lernende Person mit "Sie" an und verwende vollständige Sätze.';
        }
        if (tone === 'conversational') {
            return 'Sprich die lernende Person mit "du" an, kurz und direkt.';
        }
        return 'Vermeide "du" und "Sie"; formuliere unpersönlich, zum Beispiel "Man bestimmt zunächst ...".';
    }
    if (tone === 'formal') {
        return 'Address the learner politely and formally, in complete sentences without contractions.';
    }
    if (tone === 'conversational') {
        return 'Address the learner directly in short, spoken sentences.';
    }
    return 'Use impersonal formulations, for example "one first determines ...", and avoid addressing the learner.';
};

export const validateBriefScope = (brief: LectureBrief, scopeSlugs: readonly string[]): void => {
    const scope = new Set(scopeSlugs);
    const referenced = [...brief.objectives.map((objective) => objective.concept), ...brief.mustCover];
    const missing = [...new Set(referenced.filter((slug) => !scope.has(slug)))];

    if (missing.length > 0) {
        throw new Error(`Brief references concepts outside the lecture scope: ${missing.join(', ')}`);
    }
};
