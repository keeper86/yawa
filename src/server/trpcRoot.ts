import { initTRPC, TRPCError } from '@trpc/server';
import type { OpenApiMeta } from 'trpc-to-openapi';
import { DomainFailure, domainCodeForMessage, domainError } from './domainError';
import type { DomainErrorPacket } from './domainError';
import type { Context } from './trpcContext';

export const trpcRoot = initTRPC
    .meta<OpenApiMeta>()
    .context<Context>()
    .create({
        errorFormatter({ shape, error }) {
            const cause = error.cause as { domainError?: DomainErrorPacket } | undefined;
            const code = cause?.domainError?.code ?? domainCodeForMessage(error.message);
            return {
                ...shape,
                data: {
                    ...shape.data,
                    domainError: code ? { code, params: cause?.domainError?.params ?? {} } : null,
                },
            };
        },
    });

const domainFailureMiddleware = trpcRoot.middleware(async ({ next }) => {
    const result = await next();
    if (!result.ok && result.error.cause instanceof DomainFailure) {
        const failure = result.error.cause;
        throw domainError('BAD_REQUEST', failure.domainCode, failure.message, failure.params);
    }
    return result;
});

export const procedure = trpcRoot.procedure.use(domainFailureMiddleware);

const unauthorizedError = new TRPCError({
    code: 'UNAUTHORIZED',
    message: 'You must be logged in to access this resource or provide a valid PAT.',
    cause: { domainError: { code: 'notLoggedIn', params: {} } },
});

export const protectedProcedure = procedure.use(async ({ ctx, next }) => {
    const session = ctx.session;

    if (session.type === 'pat-auth') {
        throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'You must be personally logged in to access this resource. A PAT is not sufficient.',
        });
    }

    if (session.type === 'next-auth' && session.user?.id) {
        return next();
    }

    throw unauthorizedError;
});

export const patAccessibleProcedure = procedure.use(async ({ ctx, next }) => {
    if (ctx.session.user?.id) {
        return next();
    }

    throw unauthorizedError;
});

export const getUserIdFromContext = (ctx: Context): string => {
    const session = ctx.session;
    if (session.user?.id) {
        return session.user.id;
    }
    throw unauthorizedError;
};
