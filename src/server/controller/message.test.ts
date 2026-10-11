import { getCaller, getDb, testUsers } from 'tests/vitest/setupTestcontainer';
import { describe, expect, it } from 'vitest';

const senderId = testUsers.testUser.user_id;
const recipientId = testUsers.otherUser.user_id;
const thirdId = testUsers.otherUserTwo.user_id;

describe('message endpoints (integration)', () => {
    it('sends a message that appears in the recipient inbox and the sender sent box', async () => {
        const sender = getCaller(senderId);

        const { id } = await sender.message.sendMessage({
            recipientUserId: recipientId,
            subject: 'Hello',
            body: 'Trade offer',
        });
        expect(id).toBeTruthy();

        const inbox = await getCaller(recipientId).message.listInbox({ limit: 25, offset: 0 });
        const stored = inbox.messages.find((message) => message.id === id);
        expect(stored).toBeDefined();
        expect(stored?.subject).toBe('Hello');
        expect(stored).not.toHaveProperty('body');
        expect(stored?.counterpartUserId).toBe(senderId);
        expect(stored?.readAt).toBeNull();

        const fetched = await getCaller(recipientId).message.getMessage({ messageId: id });
        expect(fetched.body).toBe('Trade offer');

        const sent = await sender.message.listSent({ limit: 25, offset: 0 });
        expect(sent.messages.some((message) => message.id === id)).toBe(true);
    });

    it('counts unread messages and clears one on read', async () => {
        const sender = getCaller(senderId);
        const recipient = getCaller(recipientId);

        const before = await recipient.message.getUnreadCount();
        const { id } = await sender.message.sendMessage({
            recipientUserId: recipientId,
            subject: 'Unread check',
            body: 'body',
        });

        const after = await recipient.message.getUnreadCount();
        expect(after.count).toBe(before.count + 1);

        await recipient.message.markRead({ messageId: id });

        const read = await recipient.message.getUnreadCount();
        expect(read.count).toBe(before.count);
    });

    it('rejects marking a message read by someone who is not the recipient', async () => {
        const sender = getCaller(senderId);

        const { id } = await sender.message.sendMessage({
            recipientUserId: recipientId,
            subject: 'Not yours',
            body: 'body',
        });

        await expect(sender.message.markRead({ messageId: id })).rejects.toThrow();
    });

    it('marks all inbox messages read', async () => {
        const sender = getCaller(senderId);
        const recipient = getCaller(recipientId);

        await sender.message.sendMessage({ recipientUserId: recipientId, subject: 'One', body: 'body' });
        await sender.message.sendMessage({ recipientUserId: recipientId, subject: 'Two', body: 'body' });

        const result = await recipient.message.markAllRead();
        expect(result.updated).toBeGreaterThanOrEqual(2);

        const unread = await recipient.message.getUnreadCount();
        expect(unread.count).toBe(0);
    });

    it('rejects sending a message to yourself', async () => {
        const caller = getCaller(senderId);

        await expect(
            caller.message.sendMessage({ recipientUserId: senderId, subject: 'Me', body: 'body' }),
        ).rejects.toThrow();
    });

    it('rejects sending a message to an unknown recipient', async () => {
        const caller = getCaller(senderId);

        await expect(
            caller.message.sendMessage({ recipientUserId: 'does-not-exist', subject: 'Ghost', body: 'body' }),
        ).rejects.toThrow();
    });

    it('lists recipients excluding the current user', async () => {
        const caller = getCaller(senderId);

        const { recipients } = await caller.message.listRecipients({ search: '', limit: 100 });

        expect(recipients.some((recipient) => recipient.userId === senderId)).toBe(false);
        expect(recipients.some((recipient) => recipient.userId === recipientId)).toBe(true);
    });

    it('fuzzy searches recipients by display name without returning the current user', async () => {
        const caller = getCaller(senderId);

        const { recipients } = await caller.message.listRecipients({ search: 'Other Uzer', limit: 100 });
        const ids = recipients.map((recipient) => recipient.userId);

        expect(ids).not.toContain(senderId);
        expect(ids).toEqual(expect.arrayContaining([recipientId, thirdId]));
    });

    it('ranks a user id match first', async () => {
        const caller = getCaller(senderId);

        const { recipients } = await caller.message.listRecipients({ search: 'other-user', limit: 100 });

        expect(recipients[0]?.userId).toBe(recipientId);
    });

    it('respects the recipient result limit', async () => {
        const caller = getCaller(senderId);

        const { recipients } = await caller.message.listRecipients({ search: '', limit: 1 });

        expect(recipients).toHaveLength(1);
    });

    it('matches recipients by user name', async () => {
        const caller = getCaller(senderId);

        const { recipients } = await caller.message.listRecipients({ search: 'otheruser', limit: 100 });
        const ids = recipients.map((recipient) => recipient.userId);

        expect(ids).not.toContain(senderId);
        expect(ids).toEqual(expect.arrayContaining([recipientId, thirdId]));
    });

    it('returns the user name alongside the display name', async () => {
        const caller = getCaller(senderId);

        const { recipients } = await caller.message.listRecipients({ search: 'otheruser', limit: 100 });
        const match = recipients.find((recipient) => recipient.userId === recipientId);

        expect(match?.displayName).toBe('Other User');
        expect(match?.username).toBe('otheruser');
    });

    it('treats LIKE wildcards in the search literally', async () => {
        const caller = getCaller(senderId);

        const { recipients } = await caller.message.listRecipients({ search: '%', limit: 25 });

        expect(recipients).toHaveLength(0);
    });

    it('rejects an overly long recipient search', async () => {
        const caller = getCaller(senderId);

        await expect(caller.message.listRecipients({ search: 'a'.repeat(101), limit: 25 })).rejects.toThrow();
    });

    it('hides accounts with no display name or user name', async () => {
        const caller = getCaller(senderId);
        const db = getDb();

        await db('user_data').insert({
            user_id: 'faceless-user',
            display_name: null,
            username: null,
            email: 'faceless@example.com',
            avatar: null,
        });

        try {
            const listed = await caller.message.listRecipients({ search: '', limit: 100 });
            expect(listed.recipients.some((recipient) => recipient.userId === 'faceless-user')).toBe(false);

            const searched = await caller.message.listRecipients({ search: 'faceless-user', limit: 100 });
            expect(searched.recipients.some((recipient) => recipient.userId === 'faceless-user')).toBe(false);
        } finally {
            await db('user_data').where({ user_id: 'faceless-user' }).del();
        }
    });

    it('lets both participants read the body of a message', async () => {
        const { id } = await getCaller(senderId).message.sendMessage({
            recipientUserId: recipientId,
            subject: 'Body access',
            body: 'only for participants',
        });

        await expect(getCaller(senderId).message.getMessage({ messageId: id })).resolves.toEqual({
            id,
            body: 'only for participants',
        });
        await expect(getCaller(recipientId).message.getMessage({ messageId: id })).resolves.toEqual({
            id,
            body: 'only for participants',
        });
    });

    it('hides the body from someone who is not a participant', async () => {
        const { id } = await getCaller(senderId).message.sendMessage({
            recipientUserId: recipientId,
            subject: 'Private',
            body: 'secret',
        });

        await expect(getCaller(thirdId).message.getMessage({ messageId: id })).rejects.toThrow();
    });

    it('hides the body of a message the requester deleted', async () => {
        const recipient = getCaller(recipientId);

        const { id } = await getCaller(senderId).message.sendMessage({
            recipientUserId: recipientId,
            subject: 'Deleted body',
            body: 'gone',
        });
        await recipient.message.deleteMessage({ messageId: id });

        await expect(recipient.message.getMessage({ messageId: id })).rejects.toThrow();
    });

    it('rejects reading the body of an unknown message', async () => {
        await expect(
            getCaller(senderId).message.getMessage({
                messageId: '00000000-0000-0000-0000-000000000000',
            }),
        ).rejects.toThrow();
    });

    it('rejects messages from a sender who exceeds the send rate limit', async () => {
        const sender = getCaller(thirdId);

        for (let i = 0; i < 30; i += 1) {
            await sender.message.sendMessage({ recipientUserId: senderId, subject: `Bulk ${i}`, body: 'body' });
        }

        await expect(
            sender.message.sendMessage({ recipientUserId: senderId, subject: 'One too many', body: 'body' }),
        ).rejects.toThrow();
    });
});
