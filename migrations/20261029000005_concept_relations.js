exports.up = async function (knex) {
    await knex.raw(`
        CREATE TABLE concept_relations (
            id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
            source_concept_id  UUID         NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
            target_concept_id  UUID         NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
            type               TEXT         NOT NULL CHECK (type IN ('requires', 'contrasts_with')),
            status             TEXT         NOT NULL DEFAULT 'suggested'
                                            CHECK (status IN ('suggested', 'published', 'rejected')),
            created_by_user_id VARCHAR(255) REFERENCES user_data(user_id) ON DELETE SET NULL,
            created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            CHECK (source_concept_id <> target_concept_id),
            UNIQUE (source_concept_id, target_concept_id, type)
        )
    `);

    await knex.raw(`CREATE INDEX idx_relations_source ON concept_relations (source_concept_id, type, status)`);
    await knex.raw(`CREATE INDEX idx_relations_target ON concept_relations (target_concept_id, type, status)`);
};

exports.down = async function (knex) {
    await knex.schema.dropTableIfExists('concept_relations');
};
