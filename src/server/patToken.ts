import { createHash, createHmac } from 'crypto';

export const hashPatToken = (token: string): string => {
    const hmac = createHmac('sha256', process.env.PAT_TOKEN_PEPPER ?? 'default_salt');
    return createHash('sha256').update(hmac.update(token).digest('hex')).digest('hex');
};
