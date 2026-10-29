exports.up = async function (knex) {
    await knex.raw(`
        CREATE TABLE learner_concept_state (
            user_id          VARCHAR(255) NOT NULL REFERENCES user_data(user_id) ON DELETE CASCADE,
            concept_id       UUID         NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
            mastery          REAL         NOT NULL DEFAULT 0.5 CHECK (mastery BETWEEN 0 AND 1),
            confidence       REAL         NOT NULL DEFAULT 0   CHECK (confidence BETWEEN 0 AND 1),
            evidence_count   INTEGER      NOT NULL DEFAULT 0,
            last_evidence_at TIMESTAMPTZ,
            updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            PRIMARY KEY (user_id, concept_id)
        )
    `);

    await knex.raw(`
        CREATE TABLE tutor_sessions (
            id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id         VARCHAR(255) NOT NULL REFERENCES user_data(user_id) ON DELETE CASCADE,
            goal_concept_id UUID         NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
            mode            TEXT         NOT NULL DEFAULT 'study' CHECK (mode IN ('study', 'rehearsal')),
            lecture_id      UUID         REFERENCES lectures(id) ON DELETE CASCADE,
            created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            closed_at       TIMESTAMPTZ,
            CHECK (mode <> 'rehearsal' OR lecture_id IS NOT NULL)
        )
    `);
    await knex.raw(`CREATE INDEX idx_sessions_user ON tutor_sessions (user_id, created_at DESC)`);

    await knex.raw(`
        CREATE TABLE turns (
            id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
            session_id UUID         NOT NULL REFERENCES tutor_sessions(id) ON DELETE CASCADE,
            seq        INTEGER      NOT NULL,
            role       TEXT         NOT NULL CHECK (role IN ('agent', 'learner')),
            act_id     UUID         REFERENCES acts(id) ON DELETE SET NULL,
            content    JSONB        NOT NULL,
            retrieval  JSONB,
            outcome    REAL         CHECK (outcome IS NULL OR outcome BETWEEN 0 AND 1),
            created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            UNIQUE (session_id, seq)
        )
    `);

    await knex.raw(`
        CREATE TABLE learner_evidence (
            id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id    VARCHAR(255) NOT NULL REFERENCES user_data(user_id) ON DELETE CASCADE,
            concept_id UUID         NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
            turn_id    UUID         NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
            kind       TEXT         NOT NULL CHECK (kind IN ('answer', 'self_report', 'act_completed', 'act_abandoned')),
            outcome    REAL         NOT NULL CHECK (outcome BETWEEN 0 AND 1),
            created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
        )
    `);
    await knex.raw(`CREATE INDEX idx_evidence_user_concept ON learner_evidence (user_id, concept_id, created_at DESC)`);

    await knex.raw(`
        CREATE VIEW act_template_quality AS
        SELECT a.concept_id,
               a.template_id,
               t.key                           AS template_key,
               count(tr.id)                    AS uses,
               avg(tr.outcome)                 AS mean_outcome,
               count(DISTINCT tr.session_id)   AS sessions
        FROM acts a
        JOIN templates t ON t.id = a.template_id
        LEFT JOIN turns tr ON tr.act_id = a.id AND tr.role = 'agent'
        GROUP BY a.concept_id, a.template_id, t.key
    `);
};

exports.down = async function (knex) {
    await knex.raw('DROP VIEW IF EXISTS act_template_quality');
    await knex.schema.dropTableIfExists('learner_evidence');
    await knex.schema.dropTableIfExists('turns');
    await knex.schema.dropTableIfExists('tutor_sessions');
    await knex.schema.dropTableIfExists('learner_concept_state');
};
