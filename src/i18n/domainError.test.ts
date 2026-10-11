import { describe, expect, it } from 'vitest';
import { DOMAIN_ERROR_CODES, domainCodeForMessage } from '@/server/domainError';

describe('domainCodeForMessage', () => {
    it('resolves a code for every registered message', () => {
        expect(domainCodeForMessage('User not found')).toBe('userNotFound');
        expect(domainCodeForMessage('Message not found')).toBe('messageNotFound');
        expect(domainCodeForMessage('Recipient not found')).toBe('recipientNotFound');
        expect(domainCodeForMessage('Cannot send a message to yourself')).toBe('cannotMessageSelf');
        expect(domainCodeForMessage('Too many messages sent. Please wait a moment before trying again.')).toBe(
            'messageRateLimited',
        );
    });

    it('returns null for unknown messages', () => {
        expect(domainCodeForMessage('Something exploded')).toBeNull();
        expect(domainCodeForMessage('')).toBeNull();
    });

    it('exposes every code exactly once', () => {
        expect(new Set(DOMAIN_ERROR_CODES).size).toBe(DOMAIN_ERROR_CODES.length);
    });
});
