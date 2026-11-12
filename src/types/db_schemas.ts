// The TypeScript definitions below are automatically generated.
// Do not touch them, or risk, your modifications being lost.

export enum Table {
    KnexMigrations = 'knex_migrations',
    KnexMigrationsLock = 'knex_migrations_lock',
    Messages = 'messages',
    PersonalAccessTokens = 'personal_access_tokens',
    PersonalAccessTokensLogs = 'personal_access_tokens_logs',
    UserData = 'user_data',
}

export type Tables = {
    knex_migrations: KnexMigrations;
    knex_migrations_lock: KnexMigrationsLock;
    messages: Messages;
    personal_access_tokens: PersonalAccessTokens;
    personal_access_tokens_logs: PersonalAccessTokensLogs;
    user_data: UserData;
};

export type KnexMigrations = {
    id: number;
    name: string | null;
    batch: number | null;
    migration_time: Date | null;
};

export type KnexMigrationsLock = {
    index: number;
    is_locked: number | null;
};

export type Messages = {
    id: string;
    sender_user_id: string;
    recipient_user_id: string;
    subject: string;
    body: string;
    created_at: Date;
    read_at: Date | null;
    sender_deleted_at: Date | null;
    recipient_deleted_at: Date | null;
};

export type PersonalAccessTokens = {
    id: string;
    user_id: string;
    name: string;
    token_hash: string;
    expires_at: Date;
    created_at: Date;
};

export type PersonalAccessTokensLogs = {
    id: string;
    pat_id: string;
    used_at: Date;
    ip: string | null;
    user_agent: string | null;
};

export type UserData = {
    user_id: string;
    email: string;
    display_name: string | null;
    avatar: Buffer | null;
    username: string | null;
};
