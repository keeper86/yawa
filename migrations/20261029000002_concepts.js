exports.up = async function (knex) {
    await knex.raw(`
        CREATE TABLE concepts (
            id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
            slug               TEXT         NOT NULL,
            title              TEXT         NOT NULL,
            language           VARCHAR(8)   NOT NULL,
            summary            TEXT,
            wikidata_qid       VARCHAR(32),
            created_by_user_id VARCHAR(255) REFERENCES user_data(user_id) ON DELETE SET NULL,
            created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            UNIQUE (language, slug)
        )
    `);

    await knex.raw(
        `CREATE UNIQUE INDEX idx_concepts_wikidata ON concepts (wikidata_qid) WHERE wikidata_qid IS NOT NULL`,
    );
    await knex.raw(
        `CREATE INDEX idx_concepts_title_trgm ON concepts USING gin (immutable_unaccent(lower(title)) gin_trgm_ops)`,
    );
};

exports.down = async function (knex) {
    await knex.schema.dropTableIfExists('concepts');
};
