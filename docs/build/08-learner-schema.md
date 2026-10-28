# 08 — Learner schema

Depends on: 03, 05, 07. Blocks: 15, 16, 17.

## Decision gate

- Is mastery still one number per concept, or does it need per-objective granularity? One number. Objectives are review criteria for acts, not learner states.
- Is evidence always attached to a turn? Yes — a mastery change without a recorded interaction is untraceable, and traceability is what makes the model debuggable.

## Deliverables

Migration `migrations/20261029000007_learner.js` creating `learner_concept_state`, `tutor_sessions`, `turns`, `learner_evidence`, and the view `act_template_quality`.

## DDL

```sql
CREATE TABLE learner_concept_state (
    user_id          VARCHAR(255) NOT NULL REFERENCES user_data(user_id) ON DELETE CASCADE,
    concept_id       UUID         NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
    mastery          REAL         NOT NULL DEFAULT 0.5 CHECK (mastery BETWEEN 0 AND 1),
    confidence       REAL         NOT NULL DEFAULT 0   CHECK (confidence BETWEEN 0 AND 1),
    evidence_count   INTEGER      NOT NULL DEFAULT 0,
    last_evidence_at TIMESTAMPTZ,
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, concept_id)
);

CREATE TABLE tutor_sessions (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         VARCHAR(255) NOT NULL REFERENCES user_data(user_id) ON DELETE CASCADE,
    goal_concept_id UUID         NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
    mode            TEXT         NOT NULL DEFAULT 'study' CHECK (mode IN ('study', 'rehearsal')),
    lecture_id      UUID         REFERENCES lectures(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    closed_at       TIMESTAMPTZ,
    CHECK (mode <> 'rehearsal' OR lecture_id IS NOT NULL)
);
CREATE INDEX idx_sessions_user ON tutor_sessions (user_id, created_at DESC);

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
);

CREATE TABLE learner_evidence (
    id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    VARCHAR(255) NOT NULL REFERENCES user_data(user_id) ON DELETE CASCADE,
    concept_id UUID         NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
    turn_id    UUID         NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
    kind       TEXT         NOT NULL CHECK (kind IN ('answer', 'self_report', 'act_completed', 'act_abandoned')),
    outcome    REAL         NOT NULL CHECK (outcome BETWEEN 0 AND 1),
    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_evidence_user_concept ON learner_evidence (user_id, concept_id, created_at DESC);

CREATE VIEW act_template_quality AS
SELECT a.concept_id,
       a.template_id,
       t.key                           AS template_key,
       count(turn.id)                  AS uses,
       avg(turn.outcome)               AS mean_outcome,
       count(DISTINCT turn.session_id) AS sessions
FROM acts a
JOIN templates t ON t.id = a.template_id
LEFT JOIN turns turn ON turn.act_id = a.id AND turn.role = 'agent'
GROUP BY a.concept_id, a.template_id, t.key;
```

## Column notes

- **`mastery` starts at 0.5, `confidence` at 0.** A new learner is neither "probably good" nor "probably bad"; they are maximally uncertain. `confidence` grows with evidence and is what makes the agent prefer a cheap check over a full explanation.
- **`evidence_count` and `last_evidence_at` are denormalised** onto the state row so ranking does not aggregate on every request. Chunk 16 keeps them consistent inside the same transaction as the evidence insert.
- **`turns.content` is a snapshot** of what the learner actually saw, not a reference to the act. Acts can be rejected or superseded; a transcript must not change under the learner.
- **`turns.retrieval` is the audit trail** of candidate acts, scores and traversal paths. Without it there is no way to answer "why did the agent teach that", and no way to evaluate retrieval offline.
- **`outcome` lives on the agent turn that checked something.** `learner_evidence` carries the concept-level consequence.
- **`mode='rehearsal'`** is the creator testing a lecture as a learner. It requires a lecture and must not write `learner_concept_state` — enforced in chunk 16, not by the schema, because the rule concerns which rows are written, not what is valid.

## The view is a first approximation

`act_template_quality` answers "how did turns serving this act turn out". It does not answer "did mastery improve", because mastery is a delta between two states. That delta comes from windowing `learner_evidence` around a turn (chunk 16). Keep the view small and cheap; the ranker in chunk 15 applies shrinkage so a template with two uses cannot outrank a curated act.

## Down migration

Drop the view, then `learner_evidence`, `turns`, `tutor_sessions`, `learner_concept_state`.

## Acceptance

- [ ] Migration up/down/up succeeds; `npm run db:types:update` adds the four tables and the view.
- [ ] A `rehearsal` session without `lecture_id` is rejected by the CHECK.
- [ ] Two turns with the same `(session_id, seq)` are rejected.
- [ ] `mastery = 1.4` is rejected.
- [ ] Deleting an act nulls `turns.act_id` and leaves the transcript intact.

## Anti-goals

- No learner model per act or per template. Mastery is per concept.
- No spaced-repetition scheduling table yet; retrieval practice orders by `last_evidence_at`.
- No demographic or preference profile. If personalisation needs more later, it gets its own table and its own justification.
