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

- [ ] `npm run test:server` includes the structural evaluation and it fails loudly when an expectation is broken.
- [ ] Deleting one prerequisite edge breaks the prerequisite-reachability assertion (verify by doing it once).
- [ ] `seeds/10_golden_corpus.js` is idempotent: running `npm run db:seed` twice does not duplicate rows.
- [ ] The live report runs without touching CI.

## Anti-goals

- No benchmark dataset from outside this product. Generic RAG benchmarks measure the wrong thing.
- No LLM-as-judge over the corpus.
- No claim about learning outcomes until there are real learners.
