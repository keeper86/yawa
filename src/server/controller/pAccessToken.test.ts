import { getCaller, getPatCaller, testUsers } from 'tests/vitest/setupTestcontainer';
import { describe, expect, it } from 'vitest';

describe('personal access token controller (integration)', () => {
    it('creates, lists, revokes and deletes a PAT', async () => {
        const caller = getCaller(testUsers.testUser.user_id);

        const { token } = await caller.createPAT({ name: 'test-token', expiresInDays: 1 });
        expect(token).toMatch(/^[0-9a-f]{128}$/);

        const created = (await caller.listPATs({})).find((pat) => pat.name === 'test-token');
        expect(created).toBeDefined();
        expect(new Date(created!.expiresAt).getTime()).toBeGreaterThan(Date.now());

        await expect(caller.revokePAT({ id: created!.id })).resolves.toEqual({ success: true });

        const afterRevoke = (await caller.listPATs({})).find((pat) => pat.id === created!.id);
        expect(new Date(afterRevoke!.expiresAt).getTime()).toBeLessThanOrEqual(Date.now());

        await expect(caller.deletePAT({ id: created!.id })).resolves.toEqual({ success: true });

        const afterDelete = (await caller.listPATs({})).find((pat) => pat.id === created!.id);
        expect(afterDelete).toBeUndefined();
    });

    it('does not expose the tokens of other users', async () => {
        const caller = getCaller(testUsers.testUser.user_id);
        await caller.createPAT({ name: 'private-token', expiresInDays: 1 });

        const otherCaller = getCaller(testUsers.otherUser.user_id);
        const otherTokens = await otherCaller.listPATs({});

        expect(otherTokens.find((pat) => pat.name === 'private-token')).toBeUndefined();
    });

    it('rejects a PAT session on protected procedures', async () => {
        const caller = getPatCaller(testUsers.testUser.user_id);

        await expect(caller.listPATs({})).rejects.toThrow();
    });
});
