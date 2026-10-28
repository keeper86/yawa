# 07 — Lectures schema

Depends on: 02, 03, 05. Blocks: 10, 14, 18.

## Decision gate

- Are prerequisites part of the brief, or only the concept graph? Only the graph. Duplicating them into JSON would create two sources of truth for the same fact.
- Can a lecture contain acts the creator does not own? No. A lecture is a creator's curation; foreign acts enter indirectly through the concept graph at retrieval time, not through the lecture.

## Deliverables

Migration `migrations/20261029000006_lectures.js`, plus the brief zod schema in `src/server/lectures/brief.ts` with unit tests.

## DDL

```sql
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
);
CREATE INDEX idx_lectures_owner ON lectures (owner_user_id, updated_at DESC);
CREATE INDEX idx_lectures_published ON lectures (published_at) WHERE published_at IS NOT NULL;

CREATE TABLE lecture_concepts (
    lecture_id UUID NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
    concept_id UUID NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
    PRIMARY KEY (lecture_id, concept_id)
);
CREATE INDEX idx_lecture_concepts_concept ON lecture_concepts (concept_id);

CREATE TABLE lecture_sources (
    lecture_id UUID NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
    source_id  UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    PRIMARY KEY (lecture_id, source_id)
);

CREATE TABLE lecture_acts (
    lecture_id UUID    NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
    act_id     UUID    NOT NULL REFERENCES acts(id) ON DELETE CASCADE,
    position   INTEGER NOT NULL,
    PRIMARY KEY (lecture_id, act_id)
);
CREATE INDEX idx_lecture_acts_order ON lecture_acts (lecture_id, position);
```

## The brief

`brief` is the contract between the creator and the creation agent. It must be checkable, so every field is either enumerable or a list of concept slugs:

```json
{
    "audience": "B.Sc. Physik, 3. Semester",
    "objectives": [{ "concept": "trapezoidal-rule", "verb": "apply", "depth": "compute a two-interval integral" }],
    "mustCover": ["trapezoidal-rule", "simpsons-rule"],
    "mustAvoid": ["adaptive step size"],
    "durationMinutes": 90,
    "tone": "formal",
    "language": "de",
    "notes": "Students have seen Riemann sums but not interpolation."
}
```

`verb` is restricted to observable verbs (`explain`, `apply`, `compare`, `estimate`, `derive`, `classify`). "Understand" is not in the list on purpose: it cannot be reviewed against.

Two validation rules, both enforced when the creation agent starts (chunk 14) and when a lecture is published:

1. every slug in `objectives` and `mustCover` exists in `lecture_concepts`;
2. every `mustCover` slug has at least one act in the lecture.

`lecture_concepts` is the authoritative scope and may contain concepts with no objective — the creator is saying "this lecture touches this", which the graph uses for prerequisite checks.

## Publication gate

Publishing a lecture:

1. requires `brief` to pass validation;
2. requires every act in `lecture_acts` to have `status='accepted'` and `origin IN ('authored','imported','generated')` with grounding present for the latter two;
3. sets `published_at` on the lecture and on those acts, and stamps `reviewed_by_user_id`/`reviewed_at` where missing;
4. is refused if any act is `proposed` or `rejected`.

Unpublishing is refused in the MVP. Withdrawing content is a moderation concern with its own chunk; silently pulling a published act would break other creators' lectures that reference the same concept.

## The lecture does not gate retrieval

The lecture does **not** gate retrieval. The tutoring agent selects acts by concept, not by lecture (invariant 7 and chunk 15). A lecture is what a human browses, curates, reviews and shares; it is also the source of the acts the agent may serve, because only published acts are visible. Keeping those two roles separate is the reason this table has no role in the query path of chunk 15.

## Down migration

Drop `lecture_acts`, `lecture_sources`, `lecture_concepts`, `lectures`.

## Acceptance

- [ ] Migration up/down/up succeeds; `npm run db:types:update` adds the four tables.
- [ ] Brief schema rejects an unknown verb, a missing `mustCover` and an objective whose slug is absent from `lecture_concepts`.
- [ ] Publishing a lecture with one `proposed` act fails with `lectureNotPublishable` and changes nothing.
- [ ] Publishing stamps `published_at` on the lecture and on its acts in one transaction.
- [ ] Deleting a lecture leaves its acts untouched.

## Anti-goals

- No lecture versions, no forks, no draft/published branching beyond `published_at`.
- No comment threads, no review approvals by a third party.
- No lecture-level embeddings.
