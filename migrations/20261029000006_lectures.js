exports.up = async function (knex) {
    await knex.raw(`
        CREATE TABLE lectures (
            id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
            owner_user_id VARCHAR(255) NOT NULL REFERENCES user_data(user_id) ON DELETE CASCADE,
            title         TEXT         NOT NULL,
            abstract      TEXT         NOT NULL DEFAULT '',
            language      VARCHAR(8)   NOT NULL,
            brief         JSONB        NOT NULL DEFAULT '{}'::jsonb,
            published_at  TIMESTAMPTZ,
            created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
        )
    `);
    await knex.raw(`CREATE INDEX idx_lectures_owner ON lectures (owner_user_id, updated_at DESC)`);
    await knex.raw(`CREATE INDEX idx_lectures_published ON lectures (published_at) WHERE published_at IS NOT NULL`);

    await knex.raw(`
        CREATE TABLE lecture_concepts (
            lecture_id UUID NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
            concept_id UUID NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
            PRIMARY KEY (lecture_id, concept_id)
        )
    `);
    await knex.raw(`CREATE INDEX idx_lecture_concepts_concept ON lecture_concepts (concept_id)`);

    await knex.raw(`
        CREATE TABLE lecture_sources (
            lecture_id UUID NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
            source_id  UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
            PRIMARY KEY (lecture_id, source_id)
        )
    `);

    await knex.raw(`
        CREATE TABLE lecture_acts (
            lecture_id UUID    NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
            act_id     UUID    NOT NULL REFERENCES acts(id) ON DELETE CASCADE,
            position   INTEGER NOT NULL,
            PRIMARY KEY (lecture_id, act_id)
        )
    `);
    await knex.raw(`CREATE INDEX idx_lecture_acts_order ON lecture_acts (lecture_id, position)`);
};

exports.down = async function (knex) {
    await knex.schema.dropTableIfExists('lecture_acts');
    await knex.schema.dropTableIfExists('lecture_sources');
    await knex.schema.dropTableIfExists('lecture_concepts');
    await knex.schema.dropTableIfExists('lectures');
};
