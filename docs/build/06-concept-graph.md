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

- [x] Migration up/down/up succeeds; `npm run db:types:update` adds `ConceptRelations`.
- [x] Self-edge rejected by the CHECK and refused in code with a clear message.
- [x] Duplicate `(source, target, type)` rejected by the unique constraint, and `linkConcepts` reports `created: false` instead of throwing.
- [x] Cycle test on A→B→C: `C→A` refused, `B→A` refused, `C→B` refused, `A→C` **accepted** (a shortcut is not a cycle).
- [x] `contrasts_with` in both directions is collapsed to one row.
- [ ] Traversal in chunk 09 ignores `suggested` edges for a user who did not create them — belongs to that chunk.

## State after execution

Files: `migrations/20261029000005_concept_relations.js`, `src/server/graph/relations.ts`, `src/server/graph/relations.test.ts` (10 tests), `relationTypeSchema`/`relationStatusSchema` in `src/types/enums.ts`, `concept_relations` in `TABLES`.

`linkConcepts(db, candidate)` returns `{ relation, created }`: a duplicate edge is idempotent rather than an error, because the creation agent in chunk 14 proposes edges and duplicates are expected there. Chunk 10 decides whether the UI reports `created: false` as a notice.

**The transaction-abort trap, found by the test suite.** The first implementation inserted inside a transaction and caught the unique violation to re-select the existing row. Postgres aborts the entire transaction on any statement error, so the follow-up `SELECT` failed with `current transaction is aborted`. Two working alternatives exist — a `SAVEPOINT` around the insert, or checking before inserting. The code checks first, which is safe here because the transaction already holds `FOR UPDATE` locks on both concept rows: two concurrent linkers of the same pair serialise, and the second one sees the committed row. The unique constraint stays as the backstop for writes that bypass this function.

Cycle detection runs the recursive query _inside_ that transaction, after the locks, and ignores `rejected` edges — otherwise a tombstoned edge would block the corrected direction forever. A test covers exactly that.

Error signalling is still plain `Error` with a distinctive message, mapped to domain codes in chunk 10, the same deferral as chunks 03 and 05.

## Anti-goals

- No edge weights, no confidence scores, no LLM-extracted edges in this chunk. `suggested` exists; nothing creates them until chunk 14.
- No transitive closure maintenance, no materialised closure table. Depth is 2, and it is computed per query.
