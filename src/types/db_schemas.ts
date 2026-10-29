// The TypeScript definitions below are automatically generated.
// Do not touch them, or risk, your modifications being lost.

export enum Table {
    Concepts = 'concepts',
    KnexMigrations = 'knex_migrations',
    KnexMigrationsLock = 'knex_migrations_lock',
    Messages = 'messages',
    PersonalAccessTokens = 'personal_access_tokens',
    PersonalAccessTokensLogs = 'personal_access_tokens_logs',
    SourceSections = 'source_sections',
    Sources = 'sources',
    Templates = 'templates',
    UserData = 'user_data',
}

export type Tables = {
    concepts: Concepts;
    knex_migrations: KnexMigrations;
    knex_migrations_lock: KnexMigrationsLock;
    messages: Messages;
    personal_access_tokens: PersonalAccessTokens;
    personal_access_tokens_logs: PersonalAccessTokensLogs;
    source_sections: SourceSections;
    sources: Sources;
    templates: Templates;
    user_data: UserData;
};

export type Concepts = {
    id: string;
    slug: string;
    title: string;
    language: string;
    summary: string | null;
    wikidata_qid: string | null;
    created_by_user_id: string | null;
    created_at: Date;
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

export type SourceSections = {
    id: string;
    source_id: string;
    position: number;
    heading: string;
    anchor: string | null;
    content: string;
    content_hash: string;
};

export type Sources = {
    id: string;
    owner_user_id: string | null;
    kind: string;
    external_id: string;
    title: string;
    language: string;
    uri: string | null;
    license: string;
    license_url: string | null;
    source_revision: string | null;
    fetched_at: Date | null;
    created_at: Date;
};

export type Templates = {
    id: string;
    key: string;
    version: number;
    name: string;
    intent: string;
    trigger: string;
    brief_fields: string[];
    rubric: string[];
    status: string;
    created_at: Date;
};

export type UserData = {
    user_id: string;
    email: string;
    display_name: string | null;
    avatar: Buffer | null;
    username: string | null;
};
