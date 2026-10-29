exports.up = async function (knex) {
    await knex.raw(`
        CREATE TABLE templates (
            id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
            key          TEXT        NOT NULL,
            version      INTEGER     NOT NULL,
            name         TEXT        NOT NULL,
            intent       TEXT        NOT NULL,
            trigger      TEXT        NOT NULL,
            brief_fields TEXT[]      NOT NULL DEFAULT '{}',
            rubric       TEXT[]      NOT NULL DEFAULT '{}',
            status       TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
            created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (key, version)
        )
    `);

    await knex.raw(`CREATE UNIQUE INDEX idx_templates_active_key ON templates (key) WHERE status = 'active'`);

    await knex('templates').insert([
        {
            id: '00000000-0000-4000-8000-000000000001',
            key: 'worked-example',
            version: 1,
            name: 'Worked example with faded practice',
            intent: 'Let a novice follow a complete solution, then remove the support step by step until they solve the last step alone.',
            trigger: 'Low mastery, procedural concept, high element interactivity, little or no prior knowledge.',
            brief_fields: ['audience', 'objectives'],
            rubric: [
                'grounded-in-source',
                'single-concept',
                'steps-are-explicit',
                'practice-fades',
                'criterion-observable',
            ],
        },
        {
            id: '00000000-0000-4000-8000-000000000002',
            key: 'self-explanation',
            version: 1,
            name: 'Self-explanation prompt',
            intent: 'Make the learner articulate why a step is taken, so that procedural success stops hiding missing understanding.',
            trigger: 'The learner reproduces the procedure but cannot justify it, or explanations are circular.',
            brief_fields: ['audience', 'objectives'],
            rubric: ['grounded-in-source', 'single-concept', 'prompts-justification', 'criterion-observable'],
        },
        {
            id: '00000000-0000-4000-8000-000000000003',
            key: 'contrasting-cases',
            version: 1,
            name: 'Contrasting cases',
            intent: 'Put two cases side by side that differ in exactly one feature, so the learner discovers the discriminating dimension instead of being told.',
            trigger: 'Two confusable concepts, or a known misconception that survives a correct explanation.',
            brief_fields: ['audience', 'mustAvoid'],
            rubric: ['grounded-in-source', 'single-concept', 'cases-differ-in-one-feature', 'similarities-surfaced'],
        },
        {
            id: '00000000-0000-4000-8000-000000000004',
            key: 'predict-observe-explain',
            version: 1,
            name: 'Predict, observe, explain',
            intent: 'Commit to a prediction first, then confront it with the outcome, so a wrong intuition has to be revised rather than overwritten.',
            trigger:
                'An intuition is likely wrong and the consequence is observable, for example an error curve or a numerical blow-up.',
            brief_fields: ['audience', 'durationMinutes'],
            rubric: ['grounded-in-source', 'single-concept', 'prediction-before-observation', 'outcome-explained'],
        },
        {
            id: '00000000-0000-4000-8000-000000000005',
            key: 'retrieval-practice',
            version: 1,
            name: 'Retrieval practice',
            intent: 'Force recall without cues, because retrieving is what consolidates, not re-reading.',
            trigger: 'Concept previously mastered but not durable, or a long gap since the last evidence.',
            brief_fields: ['objectives', 'durationMinutes'],
            rubric: ['grounded-in-source', 'single-concept', 'no-cue-in-question', 'criterion-observable'],
        },
    ]);
};

exports.down = async function (knex) {
    await knex.schema.dropTableIfExists('templates');
};
