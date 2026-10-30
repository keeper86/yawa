import type { ActOrigin } from '@/types/enums';

export type Diagnosis = {
    mastery: number;
    confidence: number;
    evidenceCount: number;
    lastSeenDaysAgo: number | null;
    misconception: boolean;
};

export type ScoreComponents = {
    seed: number;
    originWeight: number;
    templateFit: number;
    quality: number;
    hopDecay: number;
    learnerFit: number;
};

const PRIOR_QUALITY = 0.5;
const SHRINKAGE_USES = 5;
export const RRF_K = 60;
export const GRAPH_SEED = 0.5 / (RRF_K + 1);

export const originWeight = (origin: ActOrigin): number => (origin === 'authored' ? 1 : 0.8);

export const qualityShrinkage = (uses: number, meanOutcome: number | null): number => {
    if (uses <= 0 || meanOutcome === null) {
        return PRIOR_QUALITY;
    }
    const weight = uses / (uses + SHRINKAGE_USES);
    return weight * meanOutcome + (1 - weight) * PRIOR_QUALITY;
};

export const hopDecay = (hop: number | null): number => {
    if (hop === null) {
        return 0.9;
    }
    if (hop <= 0) {
        return 1;
    }
    return hop === 1 ? 0.8 : 0.6;
};

const preferredTemplate = (diagnosis: Diagnosis): string | null => {
    if (diagnosis.misconception) {
        return 'contrasting-cases';
    }
    if (diagnosis.evidenceCount === 0 || diagnosis.mastery < 0.4) {
        return 'worked-example';
    }
    if (diagnosis.mastery < 0.7) {
        return 'self-explanation';
    }
    if (diagnosis.lastSeenDaysAgo !== null && diagnosis.lastSeenDaysAgo >= 14) {
        return 'retrieval-practice';
    }
    return null;
};

export const templateFit = (diagnosis: Diagnosis, templateKey: string): number => {
    const preferred = preferredTemplate(diagnosis);
    if (preferred === null) {
        return 0.5;
    }
    if (templateKey === preferred) {
        return 1;
    }
    if (preferred === 'worked-example' && templateKey === 'retrieval-practice') {
        return 0.2;
    }
    return 0.5;
};

export const learnerFit = (diagnosis: Diagnosis, templateKey: string): number => {
    if (templateKey === 'retrieval-practice' && diagnosis.mastery < 0.4) {
        return 0.5;
    }
    if (templateKey === 'worked-example' && diagnosis.mastery > 0.8) {
        return 0.6;
    }
    if (templateKey === 'self-explanation' && diagnosis.mastery < 0.2) {
        return 0.6;
    }
    return 1;
};

export const scoreComponents = (input: {
    seed: number;
    origin: ActOrigin;
    templateKey: string;
    uses: number;
    meanOutcome: number | null;
    hop: number | null;
    diagnosis: Diagnosis;
}): ScoreComponents => ({
    seed: input.seed,
    originWeight: originWeight(input.origin),
    templateFit: templateFit(input.diagnosis, input.templateKey),
    quality: qualityShrinkage(input.uses, input.meanOutcome),
    hopDecay: hopDecay(input.hop),
    learnerFit: learnerFit(input.diagnosis, input.templateKey),
});

export const totalScore = (components: ScoreComponents): number =>
    components.seed *
    components.originWeight *
    components.templateFit *
    components.quality *
    components.hopDecay *
    components.learnerFit;
