export type LearnerState = {
    mastery: number;
    confidence: number;
    evidenceCount: number;
};

export type MasteryUpdate = LearnerState;

const MIN_STEP = 0.08;
const MAX_STEP = 0.4;
const LOWER_BOUND = 0.02;
const UPPER_BOUND = 0.98;

export const learningRate = (evidenceCount: number): number => {
    const step = MAX_STEP / (1 + 0.3 * Math.max(0, evidenceCount - 1));
    return Math.min(MAX_STEP, Math.max(MIN_STEP, step));
};

export const updateMastery = (current: LearnerState, outcome: number): MasteryUpdate => {
    const clamped = Math.min(1, Math.max(0, outcome));
    const evidenceCount = current.evidenceCount + 1;
    const alpha = learningRate(evidenceCount);
    const mastery = current.mastery + alpha * (clamped - current.mastery);

    return {
        mastery: Math.min(UPPER_BOUND, Math.max(LOWER_BOUND, mastery)),
        confidence: 1 - 0.5 ** (evidenceCount / 3),
        evidenceCount,
    };
};

export const needsAttention = (state: LearnerState): number => (1 - state.mastery) * (0.3 + 0.7 * state.confidence);
