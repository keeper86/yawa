# Build guideline

This directory is the plan of record. It is a guideline, not a fixed specification: the codebase moves between sessions, so every chunk starts with a **decision gate** that must be re-read and adapted before it is executed. Adapt the chunk, do not silently deviate from it — if a chunk turns out to be wrong, change the chunk in the same commit as the code.

## What is being built

An adaptive tutoring platform. A creator assembles a **lecture** — a brief, the source material they consider relevant, and the concepts it covers. A creation agent drafts **acts**: reviewable teaching scripts, each an instantiation of a **didactic template** for exactly one **concept**, grounded in source passages. The creator accepts or rejects them. Accepted acts are what the tutoring agent serves to a learner, chosen from the learner's persistent concept-level knowledge state.

## Reading order

| #   | Chunk                                                  | Delivers                                                             |
| --- | ------------------------------------------------------ | -------------------------------------------------------------------- |
| —   | [00-conventions.md](00-conventions.md)                 | Vocabulary, invariants, house rules, how to adapt a chunk            |
| 01  | [01-environment.md](01-environment.md)                 | Ollama, DeepSeek, pgvector, env vars, measured embedding dimension   |
| 02  | [02-sources-schema.md](02-sources-schema.md)           | `sources`, `source_sections`, provenance and attribution             |
| 03  | [03-concepts-schema.md](03-concepts-schema.md)         | `concepts`, shared nodes, dedupe                                     |
| 04  | [04-templates-schema.md](04-templates-schema.md)       | `templates`, versioning, the first five templates                    |
| 05  | [05-acts-schema.md](05-acts-schema.md)                 | `acts`, `act_grounding`, `act_references`, review states, embeddings |
| 06  | [06-concept-graph.md](06-concept-graph.md)             | `concept_relations`, `requires`, cycle rules                         |
| 07  | [07-lectures-schema.md](07-lectures-schema.md)         | `lectures`, brief, scope, ordered acts, publication gate             |
| 08  | [08-learner-schema.md](08-learner-schema.md)           | Learner state, evidence, sessions, turns, quality view               |
| 09  | [09-traversal.md](09-traversal.md)                     | Recursive-CTE traversal service and benchmark                        |
| 10  | [10-content-controllers.md](10-content-controllers.md) | tRPC procedures, ownership, publish gate, error codes                |
| 11  | [11-ai-client.md](11-ai-client.md)                     | OpenAI-compatible chat and embeddings client, fake provider          |
| 12  | [12-embedding-pipeline.md](12-embedding-pipeline.md)   | Batching, idempotency, model bookkeeping                             |
| 13  | [13-wikipedia-import.md](13-wikipedia-import.md)       | Resolve, import, attribute, dedupe                                   |
| 14  | [14-creation-agent.md](14-creation-agent.md)           | Brief to plan to grounded act drafts, exemplars                      |
| 15  | [15-retrieval.md](15-retrieval.md)                     | Hybrid retrieval, graph expansion, learner-aware ranking             |
| 16  | [16-tutor-loop.md](16-tutor-loop.md)                   | Act execution, evidence, mastery, rehearsal                          |
| 17  | [17-golden-corpus.md](17-golden-corpus.md)             | Seed corpus and evaluation harness                                   |
| 18  | [18-ui.md](18-ui.md)                                   | Brief editor, review queue, graph, tutor view                        |

Schema chunks are 02–08. Do not execute two of them in one go: each ends with a migration that runs up, down and up again, and a green `npm run test:all`.

## Working agreement

1. Read the decision gate, then the invariants in [00-conventions.md](00-conventions.md).
2. Adapt the chunk to the current code before writing code.
3. Implement, then verify with the chunk's acceptance criteria and `npm run test:all`.
4. Update the chunk: mark what changed, record decisions that were made while executing, and remove what no longer applies. A chunk that no longer describes the code is a bug.
5. Do not run `npm run build`. There is always a dev server.

## Conventions that are not negotiable

- No comments in code. If a comment feels necessary, rename or restructure.
- Every tRPC procedure declares `.input()` and `.output()`; ownership comes from `getUserIdFromContext(ctx)`.
- User-facing failures go through `domainError` with a code registered in `DOMAIN_ERROR_CODES`, and every code needs an English and German string (`src/i18n/messages.test.ts` enforces this).
- `src/types/db_schemas.ts` is generated. Never edit it by hand; run `npm run db:types:update`.
- Tests never call a real LLM, a real embedding endpoint or Wikipedia.
- Migrations are editable in development. Until the first deployment, fix a wrong migration in place and re-run it instead of stacking a compensating migration.
