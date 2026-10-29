# 05 — Acts schema

Depends on: 02, 03, 04. Blocks: 06, 09, 10, 12.

## Decision gate

- Is the embedding dimension still 768 (see chunk 01)? It is hardcoded in this migration. Changing the model later needs `ALTER TABLE acts ALTER COLUMN embedding TYPE vector(N) USING embedding::vector(N)` on a table whose vectors all have the old dimension — plan for re-embedding, not for coexistence.
- Is `script_text` still a materialised column, or is the script flattened at query time? Keep it materialised: it is what was embedded, and reproducibility beats normalisation.

## Deliverables

Migration `migrations/20261029000004_acts.js` creating `acts`, `act_grounding`, `act_references`.

## DDL

```sql
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
);

CREATE INDEX idx_acts_concept_template ON acts (concept_id, template_id, status);
CREATE INDEX idx_acts_owner ON acts (owner_user_id, updated_at DESC);
CREATE INDEX idx_acts_pending_embedding ON acts (id) WHERE embedding IS NULL;
CREATE INDEX idx_acts_embedding
    ON acts USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
CREATE INDEX idx_acts_lexical ON acts USING gin (to_tsvector('simple', script_text));

CREATE TABLE act_grounding (
    act_id            UUID NOT NULL REFERENCES acts(id) ON DELETE CASCADE,
    source_section_id UUID NOT NULL REFERENCES source_sections(id) ON DELETE RESTRICT,
    PRIMARY KEY (act_id, source_section_id)
);
CREATE INDEX idx_act_grounding_section ON act_grounding (source_section_id);

CREATE TABLE act_references (
    act_id     UUID NOT NULL REFERENCES acts(id) ON DELETE CASCADE,
    concept_id UUID NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
    PRIMARY KEY (act_id, concept_id)
);
CREATE INDEX idx_act_references_concept ON act_references (concept_id);
```

## Column notes

- **`concept_id` is the primary target.** One act teaches one concept (invariant 3). Extra concepts go into `act_references` and are for prompt context only — never for retrieval or traversal.
- **`template_version` is frozen on the act.** The service verifies `templates.version = template_version` on insert.
- **`script_text` is the linearisation that was embedded.** Concatenate `title` and every `steps[].text` in order, newline separated. `content_hash = sha256(script_text + template.key + template_version)`. Re-embedding is driven by a hash mismatch, not by `updated_at`.
- **`status` and `published_at` are separate.** `status` is the review decision, `published_at` is visibility. An accepted but unpublished act is private; a published act is readable by everyone and only ever `accepted` — enforced by the CHECK.
- **`origin`** separates trusted from unproven material: `authored` (the creator wrote it) and `generated` (an agent drafted it). There is no `imported`: copying a source section verbatim is not an act, and nothing in the system creates one.
- **Review audit.** `reviewed_by_user_id` and `reviewed_at` answer "who let this into the corpus" — needed the first time something wrong is published.

## Publication workflow

| transition               | actor                     | guard                                                      |
| ------------------------ | ------------------------- | ---------------------------------------------------------- |
| — → `proposed`           | creation agent (chunk 14) | `origin='generated'`, grounding not empty                  |
| `proposed` → `accepted`  | creator                   | act belongs to one of the creator's lectures; rubric shown |
| `proposed` → `rejected`  | creator                   | no reason required                                         |
| `accepted` → `published` | creator                   | `status='accepted'`; generated acts have grounding         |
| published → rejected     | creator                   | refused; published acts are not silently withdrawn         |

There is no edit transition. Accepted acts are exemplars (chunk 14); a rejected act stays rejected.

## Down migration

Drop `act_references`, `act_grounding`, `acts`. Do not drop the `vector` extension while other tables still use it.

## Acceptance

- [x] Migration up/down/up succeeds; `npm run db:types:update` adds the three tables.
- [x] Setting `published_at` with `status='proposed'` fails the CHECK.
- [x] Deleting a source section referenced by `act_grounding` is refused (`ON DELETE RESTRICT`).
- [x] `EXPLAIN` on `ORDER BY embedding <=> $1 LIMIT 10` shows an index scan once a row has an embedding.
- [x] `script_text` and `content_hash` come from one shared function with unit tests, not from inline controller code.

## State after execution

Files: `migrations/20261029000004_acts.js`, `src/server/act/acts.test.ts` (12 tests), `src/lib/actScript.ts` + `src/lib/actScript.test.ts` (6 tests), `actOriginSchema`/`actStatusSchema` in `src/types/enums.ts`, the three tables in `TABLES`.

**The migration must create the extension.** The DDL block above does not mention it, and that is a trap: pgvector ships with the image but is not enabled in a fresh database, so `vector(768)` fails on any new volume and inside every testcontainer. The migration starts with `CREATE EXTENSION IF NOT EXISTS vector` and `down` deliberately does not drop it.

`acts.test.ts` covers: both enums against their CHECK constraints, default `proposed`, publication refused before acceptance, 3-dimensional vector refused with a message naming 768, 768-dimensional vector stored with its model name, section deletion refused while grounded, grounding dropped with the act, duplicate grounding and duplicate reference refused, unknown concept refused, template deletion refused while acts use it.

The HNSW check runs `EXPLAIN ... ORDER BY embedding <=> $1 LIMIT 5` inside a transaction with `SET LOCAL enable_seqscan = off`. At two rows the planner is _right_ to scan sequentially, so the test asserts the index is available rather than that the planner prefers it. Revisit the plan at corpus size (chunk 17), not now.

`origin` has two values after review: `authored` and `generated`. `imported` was dropped — a verbatim copy of a source section is not a teaching act, and no code path creates one. Invariant 6 in `00-conventions.md` was narrowed accordingly: only `generated` acts require grounding.

## Anti-goals

- No `act_relations` table. Alternatives are "other acts for the same concept with a different template", which is what the agent actually needs. Add relations when retrieval proves the need.
- No act versioning. A rejected act is replaced by generating a new one.
- No widget schema here. `script` stays `jsonb`; the template's zod schema owns its shape.
