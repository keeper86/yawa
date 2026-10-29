import { type Bead, correctOption, creditFor } from '@/lib/lesson';
import type { Tables, TutorSessions } from '@/types/db_schemas';
import type { SessionMode } from '@/types/enums';
import type { Knex } from 'knex';
import type { AiProvider } from '../ai';
import { DomainFailure } from '../domainError';
import { retrieve, topCandidates } from '../retrieval';
import type { Script } from '../templates';
import { diagnose, pickGoalConcept } from './diagnose';
import { gradeAnswer } from './grade';
import { updateMastery } from './mastery';
import { planLesson, repairBead } from './perform';

const MAX_ATTEMPTS = 2;
const CORRECT_AT = 0.7;

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
    beads: Bead[];
    retrieval: unknown;
};

export type AnswerInput =
    | { sessionId: string; userId: string; beadIndex: number; choice: { optionIndex: number } }
    | { sessionId: string; userId: string; beadIndex: number; open: { answer: string } };

export type BeadOutcome = {
    verdict: 'correct' | 'wrong';
    repair: string | null;
    revealOption: number | null;
    revealAnswer: string | null;
    nextBeadIndex: number | null;
    done: boolean;
    attempts: number;
    mastery: number | null;
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

const readBeads = (content: unknown): Bead[] => {
    if (typeof content !== 'object' || content === null) {
        return [];
    }
    const beads = (content as { beads?: unknown }).beads;
    return Array.isArray(beads) ? (beads as Bead[]) : [];
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

    const concept = await db('concepts').where({ id: act.concept_id }).first();
    if (!concept) {
        throw new DomainFailure('conceptNotFound', 'Concept not found');
    }

    const lesson = await planLesson(ai, {
        act: { id: act.id, title: act.title, script: act.script as Script },
        concept: { title: concept.title, summary: concept.summary, language: concept.language },
        diagnosis,
    });

    const [turn] = await db('turns')
        .insert({
            session_id: session.id,
            seq: await nextSeq(db, session.id),
            role: 'agent',
            act_id: act.id,
            content: { actId: act.id, title: act.title, beads: lesson.beads },
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
        beads: lesson.beads,
        retrieval: turn.retrieval,
    };
};

const judge = async (
    ai: AiProvider,
    bead: Bead,
    input: AnswerInput,
): Promise<{ correct: boolean; chosen: { text: string; why: string }; answer: string | null }> => {
    if (bead.kind === 'choice') {
        if (!('choice' in input)) {
            throw new DomainFailure('invalidAnswer', 'This step expects a choice');
        }
        const option = bead.options[input.choice.optionIndex];
        if (!option) {
            throw new DomainFailure('invalidAnswer', 'There is no such option');
        }
        return { correct: option.correct, chosen: { text: option.text, why: option.why }, answer: null };
    }

    if (!('open' in input)) {
        throw new DomainFailure('invalidAnswer', 'This step expects a written answer');
    }
    const grade = await gradeAnswer(ai, { criterion: bead.expects, answer: input.open.answer });
    return {
        correct: grade.score >= CORRECT_AT,
        chosen: { text: input.open.answer, why: grade.reason },
        answer: input.open.answer,
    };
};

const recordEvidence = async (
    db: Knex<Tables>,
    input: { session: TutorSessions; turnId: string; credit: number },
): Promise<number> =>
    db.transaction(async (trx) => {
        const current = await trx('learner_concept_state')
            .where({ user_id: input.session.user_id, concept_id: input.session.goal_concept_id })
            .forUpdate()
            .first();

        const updated = updateMastery(
            {
                mastery: current?.mastery ?? 0.5,
                confidence: current?.confidence ?? 0,
                evidenceCount: current?.evidence_count ?? 0,
            },
            input.credit,
        );

        await trx('learner_evidence').insert({
            user_id: input.session.user_id,
            concept_id: input.session.goal_concept_id,
            turn_id: input.turnId,
            kind: 'answer',
            outcome: input.credit,
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
                .where({ user_id: input.session.user_id, concept_id: input.session.goal_concept_id })
                .update(values);
        } else {
            await trx('learner_concept_state').insert({
                user_id: input.session.user_id,
                concept_id: input.session.goal_concept_id,
                ...values,
            });
        }

        return updated.mastery;
    });

export const answerBead = async (db: Knex<Tables>, ai: AiProvider, input: AnswerInput): Promise<BeadOutcome> => {
    const session = await loadSession(db, input.sessionId, input.userId);

    const lessonTurn = await db('turns')
        .where({ session_id: session.id, role: 'agent' })
        .whereNotNull('act_id')
        .whereRaw("jsonb_exists(content, 'beads')")
        .orderBy('seq', 'desc')
        .first();
    if (!lessonTurn || lessonTurn.act_id === null) {
        throw new DomainFailure('noActAvailable', 'There is no lesson waiting for an answer');
    }

    const beads = readBeads(lessonTurn.content);
    const bead = beads[input.beadIndex];
    if (!bead) {
        throw new DomainFailure('actNotFound', 'This lesson has no such step');
    }

    const answered = await judge(ai, bead, input);
    const previous = await db('turns')
        .where({ session_id: session.id, role: 'learner' })
        .where('seq', '>', lessonTurn.seq)
        .whereRaw("content->>'beadIndex' = ?", [String(input.beadIndex)]);
    if (previous.length >= MAX_ATTEMPTS) {
        throw new DomainFailure('invalidAnswer', 'This step is already answered');
    }
    const attempts = previous.length + 1;
    const resolved = answered.correct || attempts >= MAX_ATTEMPTS;

    const [learnerTurn] = await db('turns')
        .insert({
            session_id: session.id,
            seq: await nextSeq(db, session.id),
            role: 'learner',
            act_id: null,
            content:
                answered.answer === null
                    ? { beadIndex: input.beadIndex, optionIndex: 'choice' in input ? input.choice.optionIndex : null }
                    : { beadIndex: input.beadIndex, answer: answered.answer },
        })
        .returning('*');

    const repair =
        answered.correct || resolved
            ? null
            : await repairBead(ai, { bead, chosen: answered.chosen, attempt: attempts });
    const revealOption = resolved && !answered.correct && bead.kind === 'choice' ? correctOption(bead) : null;
    const revealAnswer = resolved && !answered.correct && bead.kind === 'open' ? bead.expects : null;
    const nextBeadIndex = resolved ? input.beadIndex + 1 : null;
    const done = resolved && input.beadIndex + 1 >= beads.length;
    const credit = creditFor({ correct: answered.correct, attempts, revealed: !answered.correct });

    await db('turns').insert({
        session_id: session.id,
        seq: await nextSeq(db, session.id),
        role: 'agent',
        act_id: lessonTurn.act_id,
        content: {
            beadIndex: input.beadIndex,
            verdict: answered.correct ? 'correct' : 'wrong',
            repair,
            revealOption,
            revealAnswer,
        },
        outcome: credit,
    });

    const outcome: BeadOutcome = {
        verdict: answered.correct ? 'correct' : 'wrong',
        repair,
        revealOption,
        revealAnswer,
        nextBeadIndex,
        done,
        attempts,
        mastery: null,
    };

    if (!resolved || session.mode === 'rehearsal') {
        return outcome;
    }

    return { ...outcome, mastery: await recordEvidence(db, { session, turnId: learnerTurn.id, credit }) };
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
