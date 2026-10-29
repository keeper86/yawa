exports.up = async function (knex) {
    await knex.raw(`
        CREATE TABLE creation_jobs (
            id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
            lecture_id          UUID        NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
            requested_by_user_id VARCHAR(255) NOT NULL REFERENCES user_data(user_id) ON DELETE CASCADE,
            status              TEXT        NOT NULL DEFAULT 'planning'
                                        CHECK (status IN ('planning', 'plan_ready', 'generating', 'completed', 'failed')),
            plan                JSONB,
            error               TEXT,
            created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await knex.raw(`CREATE INDEX idx_creation_jobs_lecture ON creation_jobs (lecture_id, created_at DESC)`);
    await knex.raw(`
        CREATE UNIQUE INDEX idx_creation_jobs_active
        ON creation_jobs (lecture_id)
        WHERE status IN ('planning', 'plan_ready', 'generating')
    `);
};

exports.down = async function (knex) {
    await knex.schema.dropTableIfExists('creation_jobs');
};
