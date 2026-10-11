import { authOptions } from '@/app/api/auth/[...nextauth]/authOptions';
import type { NoAuthSession, PATSession, Session } from 'next-auth';
import { getServerSession } from 'next-auth';
import { db } from './db';
import { recordPatUsage } from './patRateLimiter';
import { hashPatToken } from './patToken';

const clientIp = (req: Request): string | null => {
    const forwardedFor = req.headers.get('x-forwarded-for');
    if (forwardedFor) {
        return forwardedFor.split(',')[0].trim();
    }
    return req.headers.get('x-real-ip') ?? req.headers.get('cf-connecting-ip');
};

const validateBearerToken = async (token: string): Promise<PATSession | null> => {
    const row = await db('personal_access_tokens')
        .where({ token_hash: hashPatToken(token) })
        .andWhere('expires_at', '>', new Date().toISOString())
        .first();

    if (!row) {
        return null;
    }

    return {
        type: 'pat-auth',
        patToken: token,
        patId: row.id,
        user: { id: row.user_id },
        expires: row.expires_at.toISOString(),
    };
};

export async function createContext(opts?: {
    req?: Request;
}): Promise<{ session: Session | PATSession | NoAuthSession }> {
    const nextAuthSession = await getServerSession(authOptions);
    if (nextAuthSession) {
        return { session: nextAuthSession };
    }

    if (opts?.req) {
        const auth = opts.req.headers.get('authorization');
        if (auth?.startsWith('Bearer ')) {
            const patSession = await validateBearerToken(auth.slice(7));
            if (patSession) {
                recordPatUsage({
                    throwOnExceed: true,
                    session: patSession,
                    ip: clientIp(opts.req),
                    userAgent: opts.req.headers.get('user-agent'),
                });
                return { session: patSession };
            }
        }
    }

    const session: NoAuthSession = {
        type: 'no-auth',
        user: null,
    };

    return { session };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
