# 15 — Retrieval

Depends on: 09, 11, 12, 14. Blocks: 16, 17.

## Decision gate

- Is the ranking still deterministic code, with the LLM only writing content? Yes. A model that both chooses the teaching move and writes it cannot be debugged, evaluated, or held to a policy.
- Is hybrid (vector + lexical + graph) still required, or has the corpus stayed small enough for lexical only? Keep hybrid: the zero-overlap prerequisite test is the guard, and it never passes on lexical alone.

## Deliverables

```
src/server/retrieval/seed.ts     vector and lexical candidate queries, RRF
src/server/retrieval/expand.ts   graph expansion around the goal concept
src/server/retrieval/rank.ts     pure scoring function
src/server/retrieval/index.ts    retrieve() orchestration, snapshot
src/server/retrieval/*.test.ts
```

## Input

```ts
type RetrievalRequest = {
    viewerUserId: string;
    goalConceptId: string;
    query: string; // the learner's words, or the concept title when there is no query yet
    diagnosis: Diagnosis; // see below
};
```

## Step 1 — candidates

Two queries, same visibility predicate (`published_at IS NOT NULL OR owner_user_id = viewer`):

```sql
SELECT id, 1 - (embedding <=> $1::vector) AS similarity
FROM acts
WHERE embedding IS NOT NULL
  AND (published_at IS NOT NULL OR owner_user_id = $2)
ORDER BY embedding <=> $1::vector
LIMIT 20;
```

```sql
SELECT id, ts_rank_cd(to_tsvector('simple', script_text), websearch_to_tsquery('simple', $1)) AS rank
FROM acts
WHERE to_tsvector('simple', script_text) @@ websearch_to_tsquery('simple', $1)
  AND (published_at IS NOT NULL OR owner_user_id = $2)
ORDER BY rank DESC
LIMIT 20;
```

Fused with reciprocal rank fusion, `k = 60`. RRF rather than score blending because the two scores are not comparable and never will be.

## Step 2 — expansion

`prerequisiteClosure([goalConceptId], { depth: 2, statuses: ['published'] })`, then `actsForConcepts` for every concept in the closure. Those acts are candidates with a hop distance, not with a similarity — which is exactly why the graph can surface an act no query would have found.

## Step 3 — rank (pure function)

```ts
score =
    rrf *
    originWeight(origin) * // authored 1.0, generated 0.8
    templateFit(diagnosis, templateKey) *
    qualityShrinkage(uses, meanOutcome) *
    hopDecay(hop) * // hop 0: 1.0, hop 1: 0.8, hop 2: 0.6
    learnerFit(mastery, confidence, templateKey);
```

- `qualityShrinkage = (n / (n + 5)) * meanOutcome + (5 / (n + 5)) * 0.5` — a template with two uses cannot outrank a curated act on the strength of two lucky outcomes.
- `templateFit` maps the diagnosis to templates: misconception → `contrasting-cases`; no prior knowledge → `worked-example`; can follow but not justify → `self-explanation`; wrong intuition → `predict-observe-explain`; mastered but stale → `retrieval-practice`; otherwise 0.5 for every template.
- `learnerFit` penalises templates that need more background than the learner has (worked example with mastery > 0.8 is wasted; retrieval practice below 0.4 is a failure generator).

`Diagnosis` is produced in chunk 16 and is a plain object: `{ mastery, confidence, evidenceCount, misconception: boolean, lastSeenDaysAgo }`. No model call. That is the point: the policy is auditable.

## Step 4 — snapshot

`retrieve()` returns candidates plus a serialisable snapshot of _why_: the seed scores, the closure with hops, the component scores of the top 10, and the excluded reasons (`not visible`, `no embedding`, `template retired`). Chunk 16 stores it in `turns.retrieval`. Without it, "why did the agent teach that" has no answer, and offline evaluation has no input.

## The test that matters

Fixture: concept `simpsons-rule` requires `interpolation`. `simpsons-rule` has three acts whose text never contains the word "interpolation" or "Stützstelle". `interpolation` has one act, in another creator's published lecture, sharing no vocabulary with the query "Warum stimmt meine Simpson-Näherung nicht?".

Assertions:

1. lexical-only retrieval does **not** return the interpolation act (proves the fixture is honest);
2. the full pipeline returns it, at hop 1;
3. the snapshot records `via: 'requires'` for it.

If that test is weakened to make ranking easier, the product's claim disappears.

## Acceptance

- [x] RRF fusion unit-tested with two synthetic ranked lists.
- [x] Ranking components unit-tested individually; `qualityShrinkage` is monotone and bounded.
- [x] The zero-overlap test above passes.
- [x] Drafts of other users are never returned; the viewer's own drafts are.
- [x] Acts without embeddings are excluded and counted in the snapshot, not silently dropped.
- [x] The whole retrieval runs in three queries plus one embedding call — four with the count of unembedded acts.

## State after execution

Files: `src/server/retrieval/{rank,seed,expand,index}.ts` and `retrieval.test.ts` (7 tests).

Two things changed because the test forced them:

**Retrieval no longer truncates.** The first version sliced the top 10 inside `retrieve`. The zero-overlap test then failed for an honest reason: with 22 acts containing the query words, a prerequisite act does not belong in the top 10, and truncating there made "found via graph" unassertable. `retrieve` now returns every scored candidate and `topCandidates(candidates, limit)` is what a caller uses for a screen. The candidate set is bounded by construction — 20 vector + 20 lexical seeds plus the acts of the closure — so it cannot grow with the corpus.

**The fixture needed a corpus.** With two acts in the table, `ORDER BY embedding <=> $1 LIMIT 20` returns both, so nothing is ever graph-_only_ and the test proved nothing. It now seeds 22 acts that do contain the query words, which saturates both seed lists; the interpolation act is then genuinely reachable only through `requires`, and the test asserts it appears with `hop: 1`, `via: 'graph'`, listed in `snapshot.graphOnlySeeds`.

`GRAPH_SEED` gives graph-only candidates a seed equal to a reciprocal-rank-fusion position of 10. Without it, any act found only through the graph scores zero and loses to everything. With a _too generous_ seed the graph would drown out lexical relevance. The value is a judgement call, not a measured one — chunk 17 is where it gets tuned against the corpus.

Known limitation, deliberately left in: `predict-observe-explain` is never chosen by the ranker. The deterministic map has no signal for "an intuition is likely wrong and the consequence is observable", and inventing one would mean guessing. That template reaches a learner only when the _creation_ plan chose it, not through tutor selection.

## Anti-goals

- No reranker model.
- No LLM in the ranking path.
- No caching layer. Measure before caching.
- No cross-encoder, no query expansion, no HyDE.
