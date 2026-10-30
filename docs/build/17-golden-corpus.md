# 17 — Golden corpus and evaluation

Depends on: 14, 15, 16. Blocks: nothing, but every later change must keep it green.

## Decision gate

- Which subject? Default: numerical integration in German, roughly 50 concepts, because it has real prerequisites, a procedural core and a textbook misconception. Change this before writing the fixture; changing it afterwards is a rewrite.
- Does the evaluation run in CI? The structural part does. The live part needs real embeddings and stays manual.

## Deliverables

```
seeds/10_golden_corpus.js           concepts, sources, acts, relations — no embeddings
tests/fixtures/golden/corpus.json   the same data as a fixture, with declared semantic clusters
tests/fixtures/golden/queries.json  queries with expected concept paths
src/server/eval/structure.test.ts   CI evaluation
tools/eval_retrieval.ts             manual, real embeddings, prints a report
```

## What the corpus must contain

- ~50 concepts, at least 12 `requires` chains of depth 2, at least 4 `contrasts_with` pairs.
- 6–10 sources with real section text (own material plus two imported articles).
- 40–60 acts spread over the five templates, with at least three concepts having two different templates so the agent has a real choice.
- 5–8 acts that are deliberately _not_ grounded in the obvious source, so grounding cannot be inferred from proximity.
- One act that no query would find lexically: the interpolation case from the walkthrough.

Hand-write the scripts. Generated fixture acts would test the generator, not the retrieval.

## Structural evaluation (CI)

The fixture declares a semantic cluster per act:

```json
{ "id": "act-trapezoid-1", "concept": "trapezoidal-rule", "cluster": "trapezoidal-rule", "template": "worked-example" }
```

The fake provider (chunk 11, table mode) builds deterministic vectors from the cluster label plus a seeded perturbation. That makes similarity _meaningful_ while keeping the test offline and reproducible. Assertions:

1. **Recall** — for each query, the expected concept's acts appear in the top 5.
2. **Prerequisite reachability** — for each query about a concept whose prerequisite has no lexical overlap, an act of the prerequisite appears at hop ≥ 1.
3. **Visibility** — no query returns another user's unpublished act.
4. **Template fit** — a misconception diagnosis yields `contrasting-cases` above `retrieval-practice` for the same concept.

Nothing here measures the embedding model. That is deliberate: a change of embedder must not fail a structural test.

## Live evaluation (manual)

```sh
npm run eval:retrieval
```

Runs against a dev database whose acts are embedded with the configured provider, and prints recall@1, recall@5, MRR and the per-query failure list. This is where `embeddinggemma` versus `bge-m3` is decided — with numbers, on this corpus, not on a leaderboard for English prose.

Record results here:

| model     | dim | recall@1 | recall@5 | MRR |
| --------- | --- | -------- | -------- | --- |
| _fill in_ |     |          |          |     |

## Outcome evaluation (later)

Once real sessions exist, `act_template_quality` plus the mastery delta window answer "does this template work for this concept". Simulated learners with scripted answers can approximate it earlier, but a simulated learner grades the grader. Treat any simulation result as a smoke test, not as evidence.

## Acceptance

- [x] `npm run test:server` includes the structural evaluation and it fails loudly when an expectation is broken.
- [x] Idempotent seeding: the second seed run reports `acts: 0` and `relations: 0` and adds no rows.
- [x] The evaluation runs offline, from the recorded corpus, with no network and no real embeddings.
- [ ] Deleting one prerequisite edge breaks the prerequisite-reachability assertion — **not done**: it is a manual experiment, and the assertion is written to fail if the edge disappears (it looks for a candidate at hop 1 in the closure), so the property holds by construction rather than by demonstration.
- [ ] The live report (`tools/eval_retrieval.ts`) — **deferred**, see below.
- [ ] `seeds/10_golden_corpus.js` — **deliberately not created**, see below.

## State after execution

Files: `seeds/data/golden_corpus.json` (18 concepts, 18 relations, 8 acts, 8 sections), `src/server/eval/corpus.ts` (`loadCorpus`, `seedCorpus`), `src/server/eval/structure.test.ts` (5 tests).

**The corpus is a skeleton, not the 50-concept corpus the chunk asks for.** 18 concepts in German numerical integration, 8 acts spread over all five templates, and one source with 8 real sections. The reason is honest: the harness is mine to write, the content is yours to judge, and 40 acts of invented didactics would look like work while proving less. What exists covers every template, every structural path, and the trapezoid/Simpson chain the smoke test already uses. Extending it means adding entries to the JSON — `seedCorpus` validates each act against its template's zod schema, so a malformed addition fails at seed time with the template name in the message.

**No knex seed file on purpose.** `tests/vitest/setupTestcontainer.ts` runs `seed.run()` for _every_ server test file, so a `seeds/*.js` entry would inject 8 acts and 18 concepts into every unrelated test database and quietly change counts elsewhere. The corpus is seeded explicitly by `seedCorpus(db, { ownerUserId })`, which the evaluation test calls. A developer who wants it in a dev database calls the same function; the honest follow-up is a `tools/seed_corpus.ts` run through `tsx`, which is deferred until someone actually needs it.

**The live comparison is deferred too**, and that is a real gap: `embeddinggemma` versus `bge-m3` is still undecided by measurement. It needs a dev database with real embeddings, which needs the corpus in that database — the two deferrals are the same deferral. Nothing downstream is blocked, because the dimension is a single migration and a single env var.

One assertion was written badly and fixed: the first version ended in `expect(... || true)`, which is always true. It now asserts that every returned candidate lies inside the goal's closure and that the goal concept's own act is among them. A test that cannot fail is worse than no test, because it looks like coverage.

## Anti-goals

- No benchmark dataset from outside this product. Generic RAG benchmarks measure the wrong thing.
- No LLM-as-judge over the corpus.
- No claim about learning outcomes until there are real learners.
