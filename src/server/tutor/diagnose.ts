import type { Tables } from '@/types/db_schemas';
import type { Knex } from 'knex';
import type { Diagnosis } from '../retrieval/rank';

const MILLISECONDS_PER_DAY = 86_400_000;
const MISCONCEPTION_THRESHOLD = 0.4;
const RECENT_EVIDENCE = 3;

export const diagnose = async (
    db: Knex<Tables>,
    userId: string,
    conceptId: string,
    now: Date = new Date(),
): Promise<Diagnosis> => {
    const state = await db('learner_concept_state').where({ user_id: userId, concept_id: conceptId }).first();

    const recent = await db('learner_evidence')
        .where({ user_id: userId, concept_id: conceptId })
        .orderBy('created_at', 'desc')
        .limit(RECENT_EVIDENCE);

    const lastSeenDaysAgo =
        state?.last_evidence_at === null || state?.last_evidence_at === undefined
            ? null
            : Math.floor((now.getTime() - state.last_evidence_at.getTime()) / MILLISECONDS_PER_DAY);

    return {
        mastery: state?.mastery ?? 0.5,
        confidence: state?.confidence ?? 0,
        evidenceCount: state?.evidence_count ?? 0,
        lastSeenDaysAgo,
        misconception:
            recent.length >= 2 &&
            recent.slice(0, 2).every((entry) => entry.outcome !== null && entry.outcome < MISCONCEPTION_THRESHOLD),
    };
};

export const pickGoalConcept = async (db: Knex<Tables>, userId: string): Promise<string | null> => {
    const candidates = (await db('acts')
        .whereNotNull('acts.published_at')
        .whereNotNull('acts.embedding')
        .distinct('acts.concept_id')) as { concept_id: string }[];

    if (candidates.length === 0) {
        return null;
    }

    const states = await db('learner_concept_state').where({ user_id: userId });
    const byConcept = new Map(states.map((state) => [state.concept_id, state]));

    let best: { conceptId: string; need: number } | null = null;
    for (const candidate of candidates) {
        const state = byConcept.get(candidate.concept_id);
        const need = (1 - (state?.mastery ?? 0.5)) * (0.3 + 0.7 * (state?.confidence ?? 0));
        if (best === null || need > best.need) {
            best = { conceptId: candidate.concept_id, need };
        }
    }

    return best?.conceptId ?? null;
};
