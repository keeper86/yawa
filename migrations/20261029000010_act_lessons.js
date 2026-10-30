exports.up = async function (knex) {
    await knex.raw(`
        CREATE TABLE act_lessons (
            id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
            act_id       UUID        NOT NULL REFERENCES acts(id) ON DELETE CASCADE,
            content_hash TEXT        NOT NULL,
            bucket       TEXT        NOT NULL CHECK (bucket IN ('novice', 'developing', 'fluent')),
            model        TEXT        NOT NULL,
            beads        JSONB       NOT NULL,
            created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (act_id, content_hash, bucket)
        )
    `);
};

exports.down = async function (knex) {
    await knex.schema.dropTableIfExists('act_lessons');
};
