# 02 — Sources schema

Depends on: 01. Blocks: 03, 13, 14.

## Decision gate

- Do uploaded files exist in the MVP at all, or only pasted text and Wikipedia? PDF parsing is deliberately out of scope, so `kind='upload'` may stay unused for a while but the column stays.
- Does the first real corpus need bilingual sources in one lecture? The `language` column assumes one language per source.

## Deliverables

Migration `migrations/20261029000001_sources.js` creating `sources` and `source_sections`. No controller, no embeddings, no UI.

## Why two tables

A source is the thing with provenance and a licence; a source section is the thing an act is grounded in, and the thing whose anchor a reviewer clicks. Acts cite sections, never whole sources — a 60 kB article is not a citable unit.

## DDL

```sql
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
);

CREATE UNIQUE INDEX idx_sources_shared_external
    ON sources (external_id) WHERE owner_user_id IS NULL;
CREATE UNIQUE INDEX idx_sources_owned_external
    ON sources (owner_user_id, external_id) WHERE owner_user_id IS NOT NULL;

CREATE TABLE source_sections (
    id           UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id    UUID    NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    position     INTEGER NOT NULL,
    heading      TEXT    NOT NULL DEFAULT '',
    anchor       TEXT,
    content      TEXT    NOT NULL,
    content_hash TEXT    NOT NULL,
    UNIQUE (source_id, position)
);
```

`owner_user_id IS NULL` means the shared corpus (Wikipedia imports). Private uploads and pastes carry an owner and dedupe per owner, so two creators uploading the same PDF do not learn about each other.

`external_id` conventions:

| kind        | `external_id`                                             |
| ----------- | --------------------------------------------------------- |
| `wikipedia` | `enwiki:7921` / `dewiki:12345` (wiki prefix plus page id) |
| `upload`    | `upload:<sha256 of the file bytes>`                       |
| `paste`     | `paste:<sha256 of the normalised text>`                   |

`license` is not optional even for pasted text: use `own-work` for a creator's own material. Wikipedia rows take the value from `action=query&meta=siteinfo&siprop=rightsinfo` at import time (currently `Creative Commons Attribution-Share Alike 4.0`), never a hardcoded string.

## Down migration

Drop `source_sections`, then `sources`. Do not drop the `vector` extension.

## Acceptance

- [x] `npm run db:migrate:latest`, `npx knex migrate:down 20261029000001_sources.js`, `npm run db:migrate:latest` all succeed.
- [x] `npm run db:types:update` adds `Sources` and `SourceSections` to `src/types/db_schemas.ts` (+29 lines).
- [x] `npm run test:server` is green, proving the migration applies to the testcontainer.
- [x] A test asserts the two partial unique indexes behave (insert twice as owner → violation; insert twice as shared → violation; same `external_id` for two different owners → allowed).
- [x] Deleting a source removes its sections.

## State after execution

Files: `migrations/20261029000001_sources.js`, `src/server/sources.test.ts` (5 tests), `sources`/`source_sections` added to `TABLES` in `src/server/db.test.ts`.

Verified: migration up → down → up; indexes present (`idx_sources_shared_external`, `idx_sources_owned_external`, `source_sections_source_id_position_key`); constraint behaviour covered by test; `src/types/db_schemas.ts` regenerated.

Deviations from the plan: none, except that the doc's DDL sketch had an index on `source_sections (source_id, position)` in addition to the unique constraint on the same columns, which is the same index twice. Only the constraint was created.

Note for later chunks: `npx knex migrate:down <file>` is the way to test a single migration's `down`. `knex migrate:rollback` rolls back the entire last batch, which on this database contains migrations that already shipped.

## Anti-goals

- No embeddings on sections. Only acts are embedded (invariant 1).
- No full-text index on sections; they are not searched.
- No PDF or slide parsing. `kind='upload'` is reserved, not implemented.
- No organiser UI. Sources are attached to a lecture as a scope declaration in chunk 07.
