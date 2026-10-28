# 03 — Concepts schema

Depends on: 02. Blocks: 04, 05, 06.

## Decision gate

- Is concept creation still implicit (a creator names a concept while writing a brief or generating acts), or is there an explicit "new concept" dialog? Implicit first; the graph explorer may add explicit creation later.
- German and English naming of the same concept: one node with two titles, or two nodes? MVP keeps one row per language and connects them via `concept_relations` only when a human says so.

## Deliverables

Migration `migrations/20261029000002_concepts.js` and a pure slug helper `src/lib/slug.ts` with unit tests.

## DDL

```sql
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
);

CREATE UNIQUE INDEX idx_concepts_wikidata
    ON concepts (wikidata_qid) WHERE wikidata_qid IS NOT NULL;
CREATE INDEX idx_concepts_title_trgm
    ON concepts USING gin (immutable_unaccent(lower(title)) gin_trgm_ops);
```

`immutable_unaccent` already exists from `20260925000001_messages.js`. Reuse it; do not redefine it.

## Slug rules

`slugify(title)` in `src/lib/slug.ts`: NFD-normalise, strip combining marks, lowercase, replace every run of non `[a-z0-9]` with `-`, trim leading/trailing `-`, cap at 120 characters. Pure function, unit-tested with German input (`Numerische Integration` → `numerische-integration`, `Größenordnung` → `grossenordnung`, `O(h²)` → `o-h`).

Dedupe is then `(language, slug)` plus case-insensitive title lookup at creation time. If an exact `wikidata_qid` already exists, reuse that row and ignore the requested title — the QID is the stronger identity.

## Creation rules

- Creating a concept that already exists returns the existing row, it does not throw. Callers want an id, not an error.
- `created_by_user_id` is attribution only, never an access check. Concepts are readable by everybody (invariant 4).
- A concept with no acts is valid and expected: a brief may declare a prerequisite the corpus does not cover yet. That gap is information, not an error.

## Down migration

Drop `concepts`. Nothing references it yet at this point.

## Acceptance

- [ ] Migration up/down/up succeeds; `npm run db:types:update` adds `Concepts`.
- [ ] `slugify` unit tests cover umlauts, existing hyphens, punctuation, digits, empty input and the 120-character cap.
- [ ] A server test asserts: same title twice → one row; same title in two languages → two rows; same `wikidata_qid` with a different title → reuse and no second row.

## Anti-goals

- No merge UI, no alias table, no concept versioning. Merging two concepts is a later chunk and will need a migration of acts and relations.
- No concept-level mastery here; that is chunk 08.
- No ownership or visibility on concepts.
