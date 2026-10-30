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

- [x] Migration up/down/up succeeds; `npm run db:types:update` adds `Concepts` (+13 lines).
- [x] `slugify` unit tests cover umlauts, eszett, existing hyphens, punctuation, digits, empty input and the 120-character cap.
- [x] A server test asserts: same title twice → one row; same title in two languages → two rows; same `wikidata_qid` with a different title → reuse and no second row.
- [x] A concept with no acts is valid — nothing references concepts yet, so it is structural rather than tested.

## State after execution

Files: `migrations/20261029000002_concepts.js`, `src/lib/slug.ts`, `src/lib/slug.test.ts` (6 tests), `src/server/concept/resolve.ts`, `src/server/concept/resolve.test.ts` (6 tests), `concepts` added to `TABLES` in `src/server/db.test.ts`.

`resolveConcept(db, candidate)` is the create-or-get path. It looks up by `wikidata_qid` first, then by `(language, slug)`, then inserts; a unique violation from a concurrent insert is caught and re-read, so two parallel calls for the same title return one row (tested with `Promise.all`). A concept created without a QID gets it attached when a later call supplies one.

Two rules the code enforces that the schema cannot:

- a title whose slug is empty throws instead of inserting a row with `slug = ''`;
- the QID is attached with `WHERE wikidata_qid IS NULL`, so an existing QID is never overwritten.

Deviations: the doc listed `slug` rules without saying where the helper lives. It is `src/lib/slug.ts` (with `foldText` in `src/lib/text.ts`), pure functions, because chunk 13 and chunk 14 both need to fold and slugify titles before they reach the database. `src/server/controller/message.ts` was refactored to use `foldText` instead of its private `normalizeSearchText`, which was the same function with a different name.

Deliberate omission: `resolveConcept` throws a plain `Error` for an unusable title. Mapping it to a domain error belongs to the controller chunk, where the error catalogue is extended.

Observation for later: `src/server/controller/message.ts` already has a private `normalizeSearchText` doing the same NFD-and-strip-diacritics step. It should use a shared helper, but not in this chunk.

## Anti-goals

- No merge UI, no alias table, no concept versioning. Merging two concepts is a later chunk and will need a migration of acts and relations.
- No concept-level mastery here; that is chunk 08.
- No ownership or visibility on concepts.
