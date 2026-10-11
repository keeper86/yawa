import { getCaller, getPatCaller, getUnauthenticatedCaller, testUsers } from 'tests/vitest/setupTestcontainer';
import { describe, expect, it } from 'vitest';

describe('user endpoint (integration)', () => {
    it('get users with pagination', async () => {
        const caller = getCaller(testUsers.testUser.user_id);

        const result = await caller.getUsers({ limit: 10, offset: 0 });
        expect(result).toHaveProperty('users');
        expect(result).toHaveProperty('total');
        expect(Array.isArray(result.users)).toBe(true);

        const users = Object.values(testUsers);

        expect(result.total).toBe(users.length + 1);
        expect(result.users).toEqual(
            expect.arrayContaining(
                users.map((u) =>
                    expect.objectContaining({
                        userId: u.user_id,
                    }),
                ),
            ),
        );
    });

    it('get user by ID', async () => {
        const caller = getCaller('somebody-else-id');

        const user = await caller.getUser({ userId: testUsers.testUser.user_id });
        expect(user.userId).toBe(testUsers.testUser.user_id);
    });

    it('update user information', async () => {
        const caller = getCaller(testUsers.testUser.user_id);

        await caller.updateUser({ displayName: 'Updated User' });

        const updatedUser = await caller.getUser({ userId: testUsers.testUser.user_id });
        expect(updatedUser).toHaveProperty('displayName', 'Updated User');
    });

    it('getting user without a session should fail', async () => {
        const anonCaller = getUnauthenticatedCaller();

        await expect(anonCaller.getUser({ userId: testUsers.testUser.user_id })).rejects.toThrow();
    });

    it('getUserIdFromSession returns the caller id', async () => {
        const caller = getCaller(testUsers.testUser.user_id);

        await expect(caller.getUserIdFromSession()).resolves.toEqual({ userId: testUsers.testUser.user_id });
    });

    it('getUserIdFromSession is accessible with a PAT session', async () => {
        const caller = getPatCaller(testUsers.testUser.user_id);

        await expect(caller.getUserIdFromSession()).resolves.toEqual({ userId: testUsers.testUser.user_id });
    });
});
