exports.up = async function (knex) {
    await knex.raw(`
        CREATE TABLE sources (
            id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
            owner_user_id   VARCHAR(255) NULL REFERENCES user_data(user_id) ON DELETE CASCADE,
            kind            TEXT         NOT NULL CHECK (kind IN ('wikipedia', 'upload', 'paste')),
            external_id     TEXT         NOT NULL,
            title           TEXT         NOT NULL,
            language        VARCHAR(8)   NOT NULL,
            uri             TEXT,
            license         TEXT         NOT NULL,
            license_url     TEXT,
            source_revision TEXT,
            fetched_at      TIMESTAMPTZ,
            created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
        )
    `);

    await knex.raw(
        `CREATE UNIQUE INDEX idx_sources_shared_external ON sources (external_id) WHERE owner_user_id IS NULL`,
    );
    await knex.raw(
        `CREATE UNIQUE INDEX idx_sources_owned_external ON sources (owner_user_id, external_id) WHERE owner_user_id IS NOT NULL`,
    );

    await knex.raw(`
        CREATE TABLE source_sections (
            id           UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
            source_id    UUID    NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
            position     INTEGER NOT NULL,
            heading      TEXT    NOT NULL DEFAULT '',
            anchor       TEXT,
            content      TEXT    NOT NULL,
            content_hash TEXT    NOT NULL,
            UNIQUE (source_id, position)
        )
    `);
};

exports.down = async function (knex) {
    await knex.schema.dropTableIfExists('source_sections');
    await knex.schema.dropTableIfExists('sources');
};
