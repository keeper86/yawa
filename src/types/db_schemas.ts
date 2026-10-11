// The TypeScript definitions below are automatically generated.
// Do not touch them, or risk, your modifications being lost.

export enum Table {
    KnexMigrations = 'knex_migrations',
    KnexMigrationsLock = 'knex_migrations_lock',
    Messages = 'messages',
    UserData = 'user_data',
}

export type Tables = {
    knex_migrations: KnexMigrations;
    knex_migrations_lock: KnexMigrationsLock;
    messages: Messages;
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

export type UserData = {
    user_id: string;
    email: string;
    display_name: string | null;
    avatar: Buffer | null;
    username: string | null;
};
