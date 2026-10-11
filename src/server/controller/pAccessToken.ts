import { randomBytes } from 'crypto';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { db } from '../db';
import { logger } from '../logger';
import { hashPatToken } from '../patToken';
import { getUserIdFromContext, protectedProcedure } from '../trpcRoot';

const MAX_ACTIVE_TOKENS = Number(process.env.MAX_ACTIVE_PERSONAL_TOKENS_PER_USER ?? 10);

const createPatInput = z.object({
    name: z.string().optional().default('token'),
    expiresInDays: z.number().min(0).max(366).optional().default(1),
});

const patToken = z.object({
    id: z.uuid(),
    name: z.string(),
    createdAt: z.string(),
    expiresAt: z.string(),
});
export type PatToken = z.infer<typeof patToken>;

export const createPAT = () => {
    return protectedProcedure
        .input(createPatInput)
        .output(z.object({ token: z.string() }))
        .mutation(async ({ ctx, input }) => {
            const userId = getUserIdFromContext(ctx);

            const activeCountRow = await db('personal_access_tokens')
                .where({ user_id: userId })
                .andWhere('expires_at', '>', new Date().toISOString())
                .count<{ count: string }>('id as count')
                .first();

            if (Number(activeCountRow?.count ?? 0) >= MAX_ACTIVE_TOKENS) {
                throw new TRPCError({
                    code: 'TOO_MANY_REQUESTS',
                    message: `Maximum number of active tokens (${MAX_ACTIVE_TOKENS}) reached`,
                });
            }

            const token = randomBytes(64).toString('hex');
            const expiresAt = new Date(Date.now() + input.expiresInDays * 24 * 3600 * 1000);

            await db('personal_access_tokens').insert({
                user_id: userId,
                name: input.name,
                token_hash: hashPatToken(token),
                expires_at: expiresAt,
            });

            logger.debug({ component: 'createPAT' }, `Created PAT for user ${userId}`);

            return { token };
        });
};

export const listPATs = () => {
    return protectedProcedure
        .input(z.object({}))
        .output(z.array(patToken))
        .query(async ({ ctx }) => {
            const userId = getUserIdFromContext(ctx);

            const rows = await db('personal_access_tokens')
                .where({ user_id: userId })
                .select('id', 'name', 'created_at', 'expires_at')
                .orderBy('created_at', 'desc');

            return rows.map((row) => ({
                id: row.id,
                name: row.name,
                createdAt: row.created_at.toISOString(),
                expiresAt: row.expires_at.toISOString(),
            }));
        });
};

export const revokePAT = () => {
    return protectedProcedure
        .input(z.object({ id: z.uuid() }))
        .output(z.object({ success: z.boolean() }))
        .mutation(async ({ ctx, input }) => {
            const userId = getUserIdFromContext(ctx);

            await db('personal_access_tokens')
                .where({ id: input.id, user_id: userId })
                .update({ expires_at: new Date() });

            return { success: true };
        });
};

export const deletePAT = () => {
    return protectedProcedure
        .input(z.object({ id: z.uuid() }))
        .output(z.object({ success: z.boolean() }))
        .mutation(async ({ ctx, input }) => {
            const userId = getUserIdFromContext(ctx);

            await db('personal_access_tokens').where({ id: input.id, user_id: userId }).delete();

            return { success: true };
        });
};
