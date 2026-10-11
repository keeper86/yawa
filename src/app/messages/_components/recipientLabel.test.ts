import { describe, expect, it } from 'vitest';
import { recipientLabel } from './recipientLabel';

describe('recipientLabel', () => {
    it('prefers the display name', () => {
        expect(recipientLabel({ userId: 'alice-1', displayName: 'Alice Anderson', username: 'aa-dev' })).toBe(
            'Alice Anderson',
        );
    });

    it('falls back to the user name when there is no display name', () => {
        expect(recipientLabel({ userId: 'x', displayName: null, username: 'x-handle' })).toBe('x-handle');
    });

    it('only uses the user id as a last resort', () => {
        expect(recipientLabel({ userId: 'x-id', displayName: null, username: null })).toBe('x-id');
    });
});
