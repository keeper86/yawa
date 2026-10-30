import { z } from 'zod';
import { beadsSchema } from '@/lib/lesson';
import { sessionModeSchema } from '@/types/enums';
import { getAi } from '../ai';
import { db } from '../db';
import { getUserIdFromContext, protectedProcedure } from '../trpcRoot';
import { diagnose } from '../tutor/diagnose';
import { answerBead, closeSession, nextAct, startSession } from '../tutor/session';

const beadOutcome = z.object({
    verdict: z.enum(['correct', 'wrong']),
    repair: z.string().nullable(),
    revealOption: z.number().nullable(),
    revealAnswer: z.string().nullable(),
    nextBeadIndex: z.number().nullable(),
    done: z.boolean(),
    attempts: z.number().int(),
    mastery: z.number().nullable(),
});

const answerInput = z.object({ sessionId: z.string().uuid(), beadIndex: z.number().int().min(0).max(5) });

export const start = () =>
    protectedProcedure
        .input(
            z.object({
                goalConceptId: z.string().uuid().nullable(),
                mode: sessionModeSchema,
                lectureId: z.string().uuid().nullable(),
            }),
        )
        .output(z.object({ sessionId: z.string(), goalConceptId: z.string(), mode: z.string() }))
        .mutation(async ({ ctx, input }) => {
            const session = await startSession(db, {
                userId: getUserIdFromContext(ctx),
                goalConceptId: input.goalConceptId,
                mode: input.mode,
                lectureId: input.lectureId,
            });
            return { sessionId: session.id, goalConceptId: session.goal_concept_id, mode: session.mode };
        });

export const next = () =>
    protectedProcedure
        .input(z.object({ sessionId: z.string().uuid(), query: z.string().trim().min(1).max(500) }))
        .output(
            z.object({
                turnId: z.string(),
                actId: z.string(),
                title: z.string(),
                beads: beadsSchema,
                retrieval: z.unknown(),
            }),
        )
        .mutation(async ({ ctx, input }) =>
            nextAct(db, getAi(), {
                sessionId: input.sessionId,
                userId: getUserIdFromContext(ctx),
                query: input.query,
            }),
        );

export const answerChoice = () =>
    protectedProcedure
        .input(answerInput.extend({ optionIndex: z.number().int().min(0).max(3) }))
        .output(beadOutcome)
        .mutation(async ({ ctx, input }) =>
            answerBead(db, getAi(), {
                sessionId: input.sessionId,
                userId: getUserIdFromContext(ctx),
                beadIndex: input.beadIndex,
                choice: { optionIndex: input.optionIndex },
            }),
        );

export const answerOpen = () =>
    protectedProcedure
        .input(answerInput.extend({ answer: z.string().trim().min(1).max(5000) }))
        .output(beadOutcome)
        .mutation(async ({ ctx, input }) =>
            answerBead(db, getAi(), {
                sessionId: input.sessionId,
                userId: getUserIdFromContext(ctx),
                beadIndex: input.beadIndex,
                open: { answer: input.answer },
            }),
        );

export const close = () =>
    protectedProcedure
        .input(z.object({ sessionId: z.string().uuid() }))
        .output(z.object({ sessionId: z.string(), closedAt: z.date().nullable() }))
        .mutation(async ({ ctx, input }) => {
            const session = await closeSession(db, {
                sessionId: input.sessionId,
                userId: getUserIdFromContext(ctx),
            });
            return { sessionId: session.id, closedAt: session.closed_at };
        });

export const conceptDiagnosis = () =>
    protectedProcedure
        .input(z.object({ conceptId: z.string().uuid() }))
        .output(
            z.object({
                mastery: z.number(),
                confidence: z.number(),
                evidenceCount: z.number().int(),
                lastSeenDaysAgo: z.number().int().nullable(),
                misconception: z.boolean(),
            }),
        )
        .query(async ({ ctx, input }) => diagnose(db, getUserIdFromContext(ctx), input.conceptId));

export const tutorRouter = { start, next, answerChoice, answerOpen, close, conceptDiagnosis };
