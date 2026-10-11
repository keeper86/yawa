import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDb } from 'tests/vitest/setupTestcontainer';
import type { FetchLike, KeycloakSyncConfig, KeycloakUser } from './keycloakUserSync';
import { logger } from './logger';

const config: KeycloakSyncConfig = {
    baseUrl: 'http://keycloak.test',
    realm: 'yawa',
    clientId: 'yawa-app',
    clientSecret: 'super-secret',
};

const loadModule = () => import('./keycloakUserSync');

function jsonResponse(body: unknown, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
    };
}

function mockKeycloakFetch(pages: KeycloakUser[][], options?: { tokenStatus?: number }) {
    const calls: string[] = [];
    let pageIndex = 0;
    const impl: FetchLike = async (url) => {
        calls.push(url);
        if (url.includes('/protocol/openid-connect/token')) {
            const status = options?.tokenStatus ?? 200;
            return jsonResponse(
                status === 200 ? { access_token: 'test-token' } : { error: 'unauthorized_client' },
                status,
            );
        }
        const page = pages[pageIndex] ?? [];
        pageIndex += 1;
        return jsonResponse(page);
    };
    return { impl, calls };
}

afterEach(async () => {
    await getDb()('user_data').where('user_id', 'like', 'kc-sync-%').del();
});

describe('keycloakUserToRow', () => {
    it('maps id, email, username and display name', async () => {
        const { keycloakUserToRow } = await loadModule();
        expect(
            keycloakUserToRow({
                id: 'kc-sync-1',
                email: 'ada@example.com',
                username: 'ada',
                firstName: 'Ada',
                lastName: 'Lovelace',
            }),
        ).toEqual({ user_id: 'kc-sync-1', email: 'ada@example.com', username: 'ada', display_name: 'Ada Lovelace' });
    });

    it('returns null when the id or email is missing', async () => {
        const { keycloakUserToRow } = await loadModule();
        expect(keycloakUserToRow({ id: 'kc-sync-2' })).toBeNull();
        expect(keycloakUserToRow({ id: '', email: 'x@example.com' })).toBeNull();
    });

    it('skips disabled and service-account users', async () => {
        const { keycloakUserToRow } = await loadModule();
        expect(keycloakUserToRow({ id: 'kc-sync-3', email: 'x@example.com', enabled: false })).toBeNull();
        expect(
            keycloakUserToRow({ id: 'kc-sync-4', email: 'x@example.com', serviceAccountClientId: 'yawa-app' }),
        ).toBeNull();
        expect(
            keycloakUserToRow({
                id: 'kc-sync-5',
                email: 'x@example.com',
                username: 'service-account-yawa-app',
            }),
        ).toBeNull();
    });

    it('leaves display_name null when no name parts exist', async () => {
        const { keycloakUserToRow } = await loadModule();
        expect(keycloakUserToRow({ id: 'kc-sync-6', email: 'x@example.com' })?.display_name).toBeNull();
    });
});

describe('syncKeycloakUsers', () => {
    it('inserts users returned by Keycloak', async () => {
        const { syncKeycloakUsers } = await loadModule();
        const { impl } = mockKeycloakFetch([
            [{ id: 'kc-sync-1', email: 'ada@example.com', username: 'ada', firstName: 'Ada', lastName: 'Lovelace' }],
        ]);

        const result = await syncKeycloakUsers({
            database: getDb(),
            config,
            fetchImpl: impl,
        });

        expect(result).toMatchObject({ added: 1, updated: 0, unchanged: 0, skipped: 0 });
        const row = await getDb()('user_data').where({ user_id: 'kc-sync-1' }).first();
        expect(row?.email).toBe('ada@example.com');
        expect(row?.username).toBe('ada');
        expect(row?.display_name).toBe('Ada Lovelace');
    });

    it('updates email/username but preserves the user-chosen display name', async () => {
        const db = getDb();
        await db('user_data').insert({
            user_id: 'kc-sync-upd',
            email: 'old@example.com',
            username: 'oldname',
            display_name: 'User Chosen Name',
            avatar: null,
        });

        const { syncKeycloakUsers } = await loadModule();
        const { impl } = mockKeycloakFetch([
            [{ id: 'kc-sync-upd', email: 'new@example.com', username: 'newname', firstName: 'Kc', lastName: 'Name' }],
        ]);

        const result = await syncKeycloakUsers({
            database: db,
            config,
            fetchImpl: impl,
        });
        expect(result).toMatchObject({ added: 0, updated: 1, unchanged: 0 });

        const row = await db('user_data').where({ user_id: 'kc-sync-upd' }).first();
        expect(row?.email).toBe('new@example.com');
        expect(row?.username).toBe('newname');
        expect(row?.display_name).toBe('User Chosen Name');
    });

    it('reports unchanged users without rewriting them', async () => {
        const db = getDb();
        await db('user_data').insert({
            user_id: 'kc-sync-same',
            email: 'same@example.com',
            username: 'same',
            display_name: 'Same',
            avatar: null,
        });

        const { syncKeycloakUsers } = await loadModule();
        const { impl } = mockKeycloakFetch([[{ id: 'kc-sync-same', email: 'same@example.com', username: 'same' }]]);

        const result = await syncKeycloakUsers({
            database: db,
            config,
            fetchImpl: impl,
        });
        expect(result).toMatchObject({ added: 0, updated: 0, unchanged: 1 });
    });

    it('does not delete users that are absent from Keycloak', async () => {
        const db = getDb();
        await db('user_data').insert({
            user_id: 'kc-sync-local',
            email: 'local@example.com',
            username: null,
            display_name: null,
            avatar: null,
        });

        const { syncKeycloakUsers } = await loadModule();
        const { impl } = mockKeycloakFetch([[{ id: 'kc-sync-present', email: 'present@example.com' }]]);
        await syncKeycloakUsers({ database: db, config, fetchImpl: impl });

        expect(await db('user_data').where({ user_id: 'kc-sync-local' }).first()).toBeDefined();
    });

    it('paginates until a short page is returned', async () => {
        const firstPage: KeycloakUser[] = Array.from({ length: 100 }, (_, i) => ({
            id: `kc-sync-page-${i}`,
            email: `page-${i}@example.com`,
        }));
        const secondPage: KeycloakUser[] = [{ id: 'kc-sync-page-100', email: 'page-100@example.com' }];

        const { syncKeycloakUsers } = await loadModule();
        const { impl, calls } = mockKeycloakFetch([firstPage, secondPage]);

        const result = await syncKeycloakUsers({
            database: getDb(),
            config,
            fetchImpl: impl,
        });

        expect(result.added).toBe(101);
        expect(calls.filter((url) => url.includes('/admin/realms/'))).toHaveLength(2);
    });

    it('fails instead of looping forever when Keycloak keeps returning full pages', async () => {
        const fullPage: KeycloakUser[] = Array.from({ length: 100 }, (_, i) => ({
            id: `kc-sync-loop-${i}`,
            email: `loop-${i}@example.com`,
        }));
        const { syncKeycloakUsers } = await loadModule();
        const { impl, calls } = mockKeycloakFetch(Array.from({ length: 100 }, () => fullPage));

        await expect(syncKeycloakUsers({ database: getDb(), config, fetchImpl: impl })).rejects.toThrow(
            /exceeded 100 pages/,
        );
        expect(calls.filter((url) => url.includes('/admin/realms/'))).toHaveLength(100);
    });

    it('skips disabled and service-account users from the list', async () => {
        const { syncKeycloakUsers } = await loadModule();
        const { impl } = mockKeycloakFetch([
            [
                { id: 'kc-sync-ok', email: 'ok@example.com' },
                { id: 'kc-sync-disabled', email: 'disabled@example.com', enabled: false },
                { id: 'kc-sync-sa', email: 'sa@example.com', serviceAccountClientId: 'yawa-app' },
                { id: 'kc-sync-noemail' },
            ],
        ]);

        const result = await syncKeycloakUsers({
            database: getDb(),
            config,
            fetchImpl: impl,
        });

        expect(result).toMatchObject({ added: 1, skipped: 3 });
    });

    it('propagates failures and leaves user_data untouched', async () => {
        const db = getDb();
        const before = await db('user_data')
            .where('user_id', 'like', 'kc-sync-%')
            .count<{ c: string }>('* as c')
            .first();

        const { syncKeycloakUsers } = await loadModule();
        const { impl } = mockKeycloakFetch([[]], { tokenStatus: 400 });

        await expect(syncKeycloakUsers({ database: db, config, fetchImpl: impl })).rejects.toThrow();

        const after = await db('user_data')
            .where('user_id', 'like', 'kc-sync-%')
            .count<{ c: string }>('* as c')
            .first();
        expect(Number(after?.c)).toBe(Number(before?.c));
    });
});

describe('resolveKeycloakSyncConfig', () => {
    it('derives the base URL from the issuer', async () => {
        const { resolveKeycloakSyncConfig } = await loadModule();
        const previousIssuer = process.env.KEYCLOAK_ISSUER;
        const previousRealm = process.env.KEYCLOAK_REALM;
        const previousClientId = process.env.KEYCLOAK_CLIENT_ID;
        process.env.KEYCLOAK_ISSUER = 'https://auth.example.com/realms/yawa';
        process.env.KEYCLOAK_REALM = 'yawa';
        process.env.KEYCLOAK_CLIENT_ID = 'yawa-app';
        try {
            const config = resolveKeycloakSyncConfig();
            expect(config.baseUrl).toBe('https://auth.example.com');
            expect(config.realm).toBe('yawa');
            expect(config.clientId).toBe('yawa-app');
        } finally {
            process.env.KEYCLOAK_ISSUER = previousIssuer;
            process.env.KEYCLOAK_REALM = previousRealm;
            process.env.KEYCLOAK_CLIENT_ID = previousClientId;
        }
    });

    it('throws when the issuer is missing', async () => {
        const { resolveKeycloakSyncConfig } = await loadModule();
        const previous = process.env.KEYCLOAK_ISSUER;
        delete process.env.KEYCLOAK_ISSUER;
        try {
            expect(() => resolveKeycloakSyncConfig()).toThrow();
        } finally {
            process.env.KEYCLOAK_ISSUER = previous;
        }
    });

    it('warns when the client secret is missing', async () => {
        const { resolveKeycloakSyncConfig } = await loadModule();
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
        const previousIssuer = process.env.KEYCLOAK_ISSUER;
        const previousSecret = process.env.KEYCLOAK_CLIENT_SECRET;
        process.env.KEYCLOAK_ISSUER = 'https://auth.example.com/realms/yawa';
        delete process.env.KEYCLOAK_CLIENT_SECRET;
        try {
            resolveKeycloakSyncConfig();
            expect(warn).toHaveBeenCalled();
        } finally {
            warn.mockRestore();
            process.env.KEYCLOAK_ISSUER = previousIssuer;
            process.env.KEYCLOAK_CLIENT_SECRET = previousSecret;
        }
    });
});
