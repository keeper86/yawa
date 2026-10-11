exports.up = async function (knex) {
    await knex.raw(`
        CREATE TABLE personal_access_tokens (
            id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id    VARCHAR(255) NOT NULL,
            name       VARCHAR(255) NOT NULL DEFAULT '',
            token_hash VARCHAR(255) NOT NULL UNIQUE,
            expires_at TIMESTAMPTZ  NOT NULL,
            created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
        )
    `);
    await knex.raw(`CREATE INDEX idx_personal_access_tokens_user_id ON personal_access_tokens (user_id)`);

    await knex.raw(`
        CREATE TABLE personal_access_tokens_logs (
            id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
            pat_id     UUID        NOT NULL REFERENCES personal_access_tokens(id) ON DELETE CASCADE,
            used_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            ip         VARCHAR(255) NULL,
            user_agent TEXT         NULL
        )
    `);
    await knex.raw(`CREATE INDEX idx_personal_access_tokens_logs_pat_id ON personal_access_tokens_logs (pat_id)`);
    await knex.raw(`CREATE INDEX idx_personal_access_tokens_logs_used_at ON personal_access_tokens_logs (used_at)`);
};

exports.down = async function (knex) {
    await knex.schema.dropTableIfExists('personal_access_tokens_logs');
    await knex.schema.dropTableIfExists('personal_access_tokens');
};
