exports.up = async function (knex) {
    await knex.raw(`
        CREATE TABLE IF NOT EXISTS documents (
            id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id        VARCHAR(255) NOT NULL,
            filename       TEXT        NOT NULL,
            content_sha256 TEXT        NOT NULL,
            byte_size      INTEGER     NOT NULL,
            page_count     INTEGER     NULL,
            content        BYTEA       NOT NULL,
            status         TEXT        NOT NULL DEFAULT 'pending',
            created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT documents_user_content_unique UNIQUE (user_id, content_sha256),
            CONSTRAINT documents_user_id_fkey FOREIGN KEY (user_id) REFERENCES user_data(user_id) ON DELETE CASCADE
        )
    `);

    await knex.raw(`CREATE INDEX IF NOT EXISTS idx_documents_user_created ON documents (user_id, created_at DESC)`);
};

exports.down = async function (knex) {
    await knex.schema.dropTableIfExists('documents');
};
