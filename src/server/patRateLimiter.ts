import { TRPCError } from '@trpc/server';
import type { NoAuthSession, PATSession } from 'next-auth';
import { db } from './db';
import { logger } from './logger';
import { rateLimitExceeded } from './rateLimit';

const PAT_WINDOW_MS = 10 * 60 * 1000;
const MAX_PAT_REQUESTS_PER_WINDOW = 5;

const patUsageTimestamps = new Map<string, number[]>();

export const recordPatUsage = ({
    throwOnExceed,
    session,
    ip,
    userAgent,
}: {
    throwOnExceed: boolean;
    session: PATSession | NoAuthSession;
    ip: string | null;
    userAgent: string | null;
}): void => {
    if (session.type !== 'pat-auth') {
        return;
    }

    void db('personal_access_tokens_logs')
        .insert({ pat_id: session.patId, used_at: new Date(), ip, user_agent: userAgent })
        .catch(() => {
            logger.debug({ component: 'patRateLimiter', patId: session.patId }, 'Failed to log PAT usage');
        });

    const exceeded = rateLimitExceeded(patUsageTimestamps, session.patId, MAX_PAT_REQUESTS_PER_WINDOW, PAT_WINDOW_MS);

    if (exceeded && throwOnExceed) {
        throw new TRPCError({
            code: 'TOO_MANY_REQUESTS',
            message: 'Too many requests from this PAT, please try again later',
        });
    }
};
