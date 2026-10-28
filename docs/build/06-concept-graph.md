# 06 — Concept graph

Depends on: 03, 05. Blocks: 09, 10, 15.

## Decision gate

- Are two relation types still enough? `requires` is the mechanic; `contrasts_with` serves misconception handling and the contrasting-cases template. Anything else needs a named consumer in the ranker before it earns a row.
- Who may create `requires` edges? A human, or the creation agent proposing them (as `suggested`)? Both, with different status defaults.

## Deliverables

Migration `migrations/20261029000005_concept_relations.js`, plus the cycle guard as a pure query in `src/server/graph/relations.ts` with tests.

## DDL

```sql
CREATE TABLE concept_relations (
    id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    source_concept_id  UUID         NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
    target_concept_id  UUID         NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
    type               TEXT         NOT NULL CHECK (type IN ('requires', 'contrasts_with')),
    status             TEXT         NOT NULL DEFAULT 'suggested'
                                    CHECK (status IN ('suggested', 'published', 'rejected')),
    created_by_user_id VARCHAR(255) REFERENCES user_data(user_id) ON DELETE SET NULL,
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CHECK (source_concept_id <> target_concept_id),
    UNIQUE (source_concept_id, target_concept_id, type)
);

CREATE INDEX idx_relations_source ON concept_relations (source_concept_id, type, status);
CREATE INDEX idx_relations_target ON concept_relations (target_concept_id, type, status);
```

## Semantics

`requires` is directed: `simpsons-rule —requires→ trapezoidal-rule` means you need the target to understand the source. Traversal goes _backwards_ along it (from the concept being taught to its prerequisites), which is why both directions are indexed.

`contrasts_with` is conceptually symmetric. Store **one** direction only — the lexicographically smaller UUID as source, enforced in the controller — and query with `OR` on both columns. Storing both directions invites pairs that disagree.

`status` is the trust level, not a lifecycle:

- `suggested` — proposed by the creation agent or an unverified import. Excluded from traversal unless the requesting user is the creator.
- `published` — accepted by a human. This is what traversal follows.
- `rejected` — kept as a tombstone so the same edge is not proposed again.

## Cycle guard

Adding `A —requires→ B` creates a cycle iff `A` is reachable from `B`. Unbounded recursion is safe here because `UNION` dedupes and the visited set terminates:

```sql
WITH RECURSIVE reach(concept_id) AS (
    SELECT $2::uuid
    UNION
    SELECT r.target_concept_id
    FROM concept_relations r
    JOIN reach ON r.source_concept_id = reach.concept_id
    WHERE r.type = 'requires' AND r.status <> 'rejected'
)
SELECT EXISTS (SELECT 1 FROM reach WHERE concept_id = $1::uuid);
```

True means "reject with `relationCycle`". Run it inside the same transaction as the insert, and lock the affected nodes with `FOR UPDATE` on `concepts` (ordered by id, to avoid deadlock) so two concurrent inserts cannot each see a cycle-free state.

`contrasts_with` is exempt — cycles there are meaningless but harmless.

## Acceptance

- [ ] Migration up/down/up succeeds; `npm run db:types:update` adds `ConceptRelations`.
- [ ] Self-edge rejected by the CHECK.
- [ ] Duplicate `(source, target, type)` rejected by the unique constraint.
- [ ] Cycle test: A→B→C, then C→A is refused with `relationCycle`; C→B is accepted; the reverse edge B→A is refused.
- [ ] `contrasts_with` in both directions is collapsed to one row.
- [ ] Traversal in chunk 09 ignores `suggested` edges for a user who did not create them.

## Anti-goals

- No edge weights, no confidence scores, no LLM-extracted edges in this chunk. `suggested` exists; nothing creates them until chunk 14.
- No transitive closure maintenance, no materialised closure table. Depth is 2, and it is computed per query.
