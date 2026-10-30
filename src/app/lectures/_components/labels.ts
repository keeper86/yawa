export const KNOWN_TEMPLATES = [
    'worked-example',
    'self-explanation',
    'contrasting-cases',
    'predict-observe-explain',
    'retrieval-practice',
] as const;

export type KnownTemplate = (typeof KNOWN_TEMPLATES)[number];

export const isKnownTemplate = (value: string): value is KnownTemplate =>
    (KNOWN_TEMPLATES as readonly string[]).includes(value);

export const KNOWN_RUBRIC_CODES = [
    'grounded-in-source',
    'single-concept',
    'steps-are-explicit',
    'practice-fades',
    'criterion-observable',
    'prompts-justification',
    'cases-differ-in-one-feature',
    'similarities-surfaced',
    'prediction-before-observation',
    'outcome-explained',
    'no-cue-in-question',
    'tone-matches-brief',
] as const;

export type KnownRubricCode = (typeof KNOWN_RUBRIC_CODES)[number];

export const isKnownRubricCode = (value: string): value is KnownRubricCode =>
    (KNOWN_RUBRIC_CODES as readonly string[]).includes(value);
