exports.up = async function (knex) {
    await knex.raw('CREATE EXTENSION IF NOT EXISTS vector');

    await knex.raw(`
        CREATE TABLE acts (
            id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
            concept_id          UUID         NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
            template_id         UUID         NOT NULL REFERENCES templates(id) ON DELETE RESTRICT,
            template_version    INTEGER      NOT NULL,
            owner_user_id       VARCHAR(255) NOT NULL REFERENCES user_data(user_id) ON DELETE CASCADE,
            origin              TEXT         NOT NULL CHECK (origin IN ('authored', 'generated')),
            status              TEXT         NOT NULL DEFAULT 'proposed'
                                            CHECK (status IN ('proposed', 'accepted', 'rejected')),
            title               TEXT         NOT NULL,
            script              JSONB        NOT NULL,
            script_text         TEXT         NOT NULL,
            content_hash        TEXT         NOT NULL,
            embedding           vector(768),
            embedding_model     TEXT,
            embedded_at         TIMESTAMPTZ,
            published_at        TIMESTAMPTZ,
            reviewed_by_user_id VARCHAR(255) REFERENCES user_data(user_id) ON DELETE SET NULL,
            reviewed_at         TIMESTAMPTZ,
            created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            CHECK (published_at IS NULL OR status = 'accepted')
        )
    `);

    await knex.raw(`CREATE INDEX idx_acts_concept_template ON acts (concept_id, template_id, status)`);
    await knex.raw(`CREATE INDEX idx_acts_owner ON acts (owner_user_id, updated_at DESC)`);
    await knex.raw(`CREATE INDEX idx_acts_pending_embedding ON acts (id) WHERE embedding IS NULL`);
    await knex.raw(
        `CREATE INDEX idx_acts_embedding ON acts USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)`,
    );
    await knex.raw(`CREATE INDEX idx_acts_lexical ON acts USING gin (to_tsvector('simple', script_text))`);

    await knex.raw(`
        CREATE TABLE act_grounding (
            act_id            UUID NOT NULL REFERENCES acts(id) ON DELETE CASCADE,
            source_section_id UUID NOT NULL REFERENCES source_sections(id) ON DELETE RESTRICT,
            PRIMARY KEY (act_id, source_section_id)
        )
    `);
    await knex.raw(`CREATE INDEX idx_act_grounding_section ON act_grounding (source_section_id)`);

    await knex.raw(`
        CREATE TABLE act_references (
            act_id     UUID NOT NULL REFERENCES acts(id) ON DELETE CASCADE,
            concept_id UUID NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
            PRIMARY KEY (act_id, concept_id)
        )
    `);
    await knex.raw(`CREATE INDEX idx_act_references_concept ON act_references (concept_id)`);
};

exports.down = async function (knex) {
    await knex.schema.dropTableIfExists('act_references');
    await knex.schema.dropTableIfExists('act_grounding');
    await knex.schema.dropTableIfExists('acts');
};
