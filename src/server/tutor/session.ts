import type { Tables, TutorSessions } from '@/types/db_schemas';
import type { SessionMode } from '@/types/enums';
import type { Knex } from 'knex';
import type { AiProvider } from '../ai';
import { DomainFailure } from '../domainError';
import { retrieve, topCandidates } from '../retrieval';
import { diagnose, pickGoalConcept } from './diagnose';
import { gradeAnswer } from './grade';
import { updateMastery } from './mastery';
import type { Script } from '../templates';

export type StartInput = {
    userId: string;
    goalConceptId: string | null;
    mode: SessionMode;
    lectureId: string | null;
};

export type NextTurn = {
    turnId: string;
    actId: string;
    title: string;
    script: Script;
    retrieval: unknown;
};

const loadSession = async (db: Knex<Tables>, sessionId: string, userId: string): Promise<TutorSessions> => {
    const session = await db('tutor_sessions').where({ id: sessionId }).first();
    if (!session) {
        throw new DomainFailure('sessionNotFound', 'Session not found');
    }
    if (session.user_id !== userId) {
        throw new DomainFailure('notOwner', 'This session belongs to someone else');
    }
    return session;
};

const nextSeq = async (db: Knex<Tables>, sessionId: string): Promise<number> => {
    const row = await db('turns').where({ session_id: sessionId }).max<{ max: number | null }>('seq as max').first();
    return (row?.max ?? 0) + 1;
};

export const startSession = async (db: Knex<Tables>, input: StartInput): Promise<TutorSessions> => {
    if (input.mode === 'rehearsal' && input.lectureId === null) {
        throw new DomainFailure('invalidBrief', 'A rehearsal needs a lecture');
    }

    const goalConceptId = input.goalConceptId ?? (await pickGoalConcept(db, input.userId));
    if (goalConceptId === null) {
        throw new DomainFailure('noActAvailable', 'There is nothing to teach yet');
    }

    const [session] = await db('tutor_sessions')
        .insert({
            user_id: input.userId,
            goal_concept_id: goalConceptId,
            mode: input.mode,
            lecture_id: input.lectureId,
        })
        .returning('*');

    return session;
};

export const nextAct = async (
    db: Knex<Tables>,
    ai: AiProvider,
    input: { sessionId: string; userId: string; query: string },
): Promise<NextTurn> => {
    const session = await loadSession(db, input.sessionId, input.userId);
    const diagnosis = await diagnose(db, session.user_id, session.goal_concept_id);

    const result = await retrieve(db, ai, {
        viewerUserId: session.user_id,
        goalConceptId: session.goal_concept_id,
        query: input.query,
        diagnosis,
    });

    const chosen = topCandidates(result.candidates, 1)[0];
    if (!chosen) {
        throw new DomainFailure('noActAvailable', 'No act fits this goal right now');
    }

    const act = await db('acts').where({ id: chosen.actId }).first();
    if (!act) {
        throw new DomainFailure('actNotFound', 'Act not found');
    }

    const [turn] = await db('turns')
        .insert({
            session_id: session.id,
            seq: await nextSeq(db, session.id),
            role: 'agent',
            act_id: act.id,
            content: { actId: act.id, title: act.title, script: act.script },
            retrieval: {
                chosen: chosen.actId,
                score: chosen.score,
                components: chosen.components,
                hop: chosen.hop,
                via: chosen.via,
                snapshot: result.snapshot,
            },
        })
        .returning('*');

    return {
        turnId: turn.id,
        actId: act.id,
        title: act.title,
        script: act.script as Script,
        retrieval: turn.retrieval,
    };
};

export const respondToAct = async (
    db: Knex<Tables>,
    ai: AiProvider,
    input: { sessionId: string; userId: string; answer: string },
): Promise<{ outcome: number; mastery: number | null }> => {
    const session = await loadSession(db, input.sessionId, input.userId);

    const presented = await db('turns')
        .where({ session_id: session.id, role: 'agent' })
        .whereNotNull('act_id')
        .orderBy('seq', 'desc')
        .first();
    if (!presented) {
        throw new DomainFailure('noActAvailable', 'There is no act waiting for an answer');
    }

    const presentedActId = presented.act_id;
    if (presentedActId === null) {
        throw new DomainFailure('noActAvailable', 'There is no act waiting for an answer');
    }

    const act = await db('acts').where({ id: presentedActId }).first();
    if (!act) {
        throw new DomainFailure('actNotFound', 'Act not found');
    }

    const script = act.script as Script;
    const grade = await gradeAnswer(ai, { criterion: script.success.criterion, answer: input.answer });

    const [answerTurn] = await db('turns')
        .insert({
            session_id: session.id,
            seq: await nextSeq(db, session.id),
            role: 'learner',
            act_id: null,
            content: { answer: input.answer },
        })
        .returning('*');

    await db('turns').insert({
        session_id: session.id,
        seq: await nextSeq(db, session.id),
        role: 'agent',
        act_id: act.id,
        content: { graded: true, reason: grade.reason, substantive: grade.substantive },
        outcome: grade.score,
    });

    if (session.mode === 'rehearsal') {
        return { outcome: grade.score, mastery: null };
    }

    return db.transaction(async (trx) => {
        const current = await trx('learner_concept_state')
            .where({ user_id: session.user_id, concept_id: session.goal_concept_id })
            .forUpdate()
            .first();

        const updated = updateMastery(
            {
                mastery: current?.mastery ?? 0.5,
                confidence: current?.confidence ?? 0,
                evidenceCount: current?.evidence_count ?? 0,
            },
            grade.score,
        );

        await trx('learner_evidence').insert({
            user_id: session.user_id,
            concept_id: session.goal_concept_id,
            turn_id: answerTurn.id,
            kind: 'answer',
            outcome: grade.score,
        });

        const values = {
            mastery: updated.mastery,
            confidence: updated.confidence,
            evidence_count: updated.evidenceCount,
            last_evidence_at: new Date(),
            updated_at: new Date(),
        };

        if (current) {
            await trx('learner_concept_state')
                .where({ user_id: session.user_id, concept_id: session.goal_concept_id })
                .update(values);
        } else {
            await trx('learner_concept_state').insert({
                user_id: session.user_id,
                concept_id: session.goal_concept_id,
                ...values,
            });
        }

        return { outcome: grade.score, mastery: updated.mastery };
    });
};

export const closeSession = async (
    db: Knex<Tables>,
    input: { sessionId: string; userId: string },
): Promise<TutorSessions> => {
    const session = await loadSession(db, input.sessionId, input.userId);
    if (session.closed_at !== null) {
        return session;
    }

    const [updated] = await db('tutor_sessions')
        .where({ id: session.id })
        .update({ closed_at: new Date() })
        .returning('*');
    return updated;
};
