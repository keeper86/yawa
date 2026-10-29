# 00 — Conventions

Depends on: nothing. Read this before any other chunk.

## Decision gate

If the vocabulary below has drifted from the code, fix this document first — every later chunk references it.

## Vocabulary

| Term               | Meaning                                                                                                                                        | Table             |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| **Concept**        | The thing to be learned. A shared graph node with app-managed identity. Not owned by a user, not a document.                                   | `concepts`        |
| **Source**         | A raw resource a creator considers relevant: uploaded file, pasted text, Wikipedia article. Enriches context, is never served to a learner.    | `sources`         |
| **Source section** | A retrievable-for-generation slice of a source. Carries the anchor used for attribution.                                                       | `source_sections` |
| **Template**       | A didactic pattern: intent, trigger condition, required brief fields, script schema, review rubric. Versioned, shared, community-maintainable. | `templates`       |
| **Act**            | A reviewable teaching _script_: one template instantiated for one concept, grounded in source sections. The unit of teaching.                  | `acts`            |
| **Lecture**        | The creator's container: brief, declared concepts, source scope, ordered acts, publication. The unit of curation.                              | `lectures`        |
| **Turn**           | One recorded exchange in a tutoring session, including the act served and the outcome.                                                         | `turns`           |
| **Exemplar**       | An accepted act, reused as a few-shot example for later generation. Not a table; a query over accepted acts.                                   | —                 |

The two sentences that pin the design down:

- **The act is the unit of teaching. The lecture is the unit of curation and publication.**
- **The agent proposes, the human judges.** Nothing an agent writes becomes visible learning material without an explicit acceptance.

## Invariants

Each is testable. A chunk that breaks one of these is wrong, regardless of how convenient the change is.

1. **Only acts are embedded.** Sources and source sections are never retrieval targets at tutoring time. They exist for generation, attribution and re-import.
2. **Visibility of an act is `published_at IS NOT NULL OR owner_user_id = caller`.** There is no third visibility rule anywhere in the system.
3. **An act teaches exactly one concept.** Additional concepts may be referenced as context (`act_references`) but are never traversal targets.
4. **Concepts are shared and unowned.** Identity is `(language, slug)`, plus `wikidata_qid` when known. No per-user concept universes.
5. **Agent output starts unaccepted.** Generation produces acts with `status='proposed'`. Only a human acceptance moves an act to `accepted`.
6. **Every act is traceable to its grounding.** `generated` and `imported` acts require at least one `act_grounding` row; `authored` acts may have none.
7. **Publication state lives on the act; ordering lives on the lecture.** A published lecture contains only published acts.
8. **Prerequisite traversal is depth-limited to 2.** Deeper gaps are reached by re-seeding from the failed prerequisite after new evidence, not by walking further in one query.
9. **No network in tests.** Chat, embeddings and Wikipedia are injected; the fake provider is the default under test.
10. **Nothing is hard-deleted that a published artefact references.** Deleting a concept, source or act either cascades through owned drafts or is refused.

## Review is the product

The creator's only action is **accept** or **reject**. There is no accept-and-edit: rewriting generated prose is the slowest possible human loop and produces content the exemplar mechanism cannot learn from. An acceptance is the training signal; a rejection is the counter-signal. Consequently the review surface must be fast rather than expressive: grouped by template and concept, keyboard-driven, grounding passages inline, no modal chains.

## House rules

- No comments in code. Rename or restructure instead.
- Prettier: 4 spaces, 120 columns, single quotes, semicolons, trailing commas.
- Every tRPC procedure has `.input()` and `.output()` zod schemas. Ownership from `getUserIdFromContext(ctx)`.
- Domain errors: `domainError(code, domainCode, message, params)` plus a `DOMAIN_ERROR_CODES` entry plus English and German strings.
- `src/types/db_schemas.ts` is generated (`npm run db:types:update`).
- Server integration tests live beside controllers as `*.test.ts` and run against a testcontainer; unit tests run in jsdom.
- Migrations are replaceable during development. Fix in place and re-run; no compensating migrations before the first deployment. Test a single `down` with `npx knex migrate:down <file>` — `knex migrate:rollback` takes the whole batch down, including migrations that already shipped.
- Verify with `npm run test:all`. Never `npm run build`.

## How to adapt a chunk

1. Read the decision gate and answer it against the current code.
2. Read the acceptance criteria — they are the contract, not the file list.
3. If the code has moved, change the chunk before the code, in the same commit.
4. Execute, verify, then rewrite the chunk's "state after execution" section so the next reader starts from truth.

## Anti-goals

Deliberately out of scope. Revisit only with evidence.

- An organiser or filing UI for sources. The creation agent selects within the creator's scope.
- Accept-and-edit of generated acts.
- Branching act scripts. Linear steps with free text.
- Votes, stars or likes as a quality signal. Quality is measured as mastery delta per `(concept, template, learner-state bucket)`.
- Bulk import of Wikipedia. Terms are linked on demand.
- PDF parsing, exercise groups, lecture versioning, forking, approval workflows.
