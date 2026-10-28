# 09 — Traversal

Depends on: 05, 06, 08. Blocks: 15, 16.

## Decision gate

- Is depth still 2? Verify against the tutor loop in chunk 16: deeper gaps are reached by re-seeding from the failed prerequisite once new evidence exists, so the query never needs to walk further.
- Are `suggested` edges visible to their creator during rehearsal? Yes. Traversal takes the viewer into account.

## Deliverables

`src/server/graph/traversal.ts` with two query builders, `src/server/graph/traversal.test.ts`, and an opt-in benchmark.

## API

```ts
export type RelationStatus = 'suggested' | 'published' | 'rejected';

export const prerequisiteClosure = async (
    conceptIds: string[],
    options: { depth: 1 | 2; statuses: RelationStatus[] },
): Promise<Map<string, number>>;

export const actsForConcepts = async (
    conceptIds: string[],
    viewerUserId: string,
): Promise<ActCandidate[]>;
```

`prerequisiteClosure` returns each reachable prerequisite with its minimum hop count. Minimum, not all paths: the ranker cares about distance, and duplicate paths are noise.

## Query

```sql
WITH RECURSIVE walk(concept_id, hop) AS (
    SELECT unnest($1::uuid[]), 0
    UNION
    SELECT r.target_concept_id, w.hop + 1
    FROM concept_relations r
    JOIN walk w ON r.source_concept_id = w.concept_id
    WHERE r.type = 'requires'
      AND r.status = ANY($2::text[])
      AND w.hop < $3
)
SELECT concept_id, min(hop) AS hop
FROM walk
WHERE hop > 0
GROUP BY concept_id;
```

The rules that keep this fast, in order of how much they matter:

1. **Ids only in the recursive term.** Selecting `content` or joining `acts` inside the CTE is the usual reason these queries fall over: the working table is not indexed, and every iteration carries whatever you put in it.
2. **Every filter inside the recursive term.** Postgres cannot push predicates into a recursive CTE. A `status` filter outside it means the traversal walks rejected edges and discards them later.
3. **`UNION`, not `UNION ALL`.** Deduplication is what makes cycles terminate. With the `hop < depth` guard it is belt and braces, and both are intended.
4. **Both index directions exist** (chunk 06). The `JOIN walk ON r.source_concept_id` uses `idx_relations_source`; queries that walk the other way use `idx_relations_target`.

`actsForConcepts` is deliberately a separate, flat query — one `WHERE concept_id = ANY(...) AND (published_at IS NOT NULL OR owner_user_id = $2)` — never a join against the CTE. Composing the two in SQL is how you get a query that cannot be planned.

## Benchmark

Correctness lives in `traversal.test.ts` against a hand-built fixture (A→B→C→D, an alternative path, a rejected edge, a suggested edge).

Performance is opt-in so CI stays fast:

```sh
GRAPH_BENCH_SCALE=100000 npm run test:server -- src/server/graph/traversal.benchmark.test.ts
```

The benchmark seeds N `requires` edges over `N/20` concepts, warms once, then measures 100 traversals at depth 2 and asserts p95 < 20 ms and that `EXPLAIN` contains an index scan on `idx_relations_source`. When `GRAPH_BENCH_SCALE` is unset the test skips.

Record here after execution:

| edges     | p95 depth-2 traversal | plan |
| --------- | --------------------- | ---- |
| _fill in_ |                       |      |

## Acceptance

- [ ] Depth 1 returns direct prerequisites only; depth 2 returns two hops and never three.
- [ ] `min(hop)` is reported when two paths reach the same concept.
- [ ] A rejected edge is never traversed; a suggested edge is traversed only when `statuses` includes it.
- [ ] Cycles in the fixture terminate and do not duplicate results.
- [ ] `actsForConcepts` excludes unpublished acts of other users and includes the viewer's own drafts.
- [ ] Benchmark passes at 100k edges with p95 < 20 ms.

## Anti-goals

- No Apache AGE, no Neo4j, no closure table, no cached neighbourhoods.
- No variable-length paths, no shortest-path scoring, no centrality.
- No traversal computed in JavaScript. If it cannot be expressed in one SQL statement, the model is wrong.
