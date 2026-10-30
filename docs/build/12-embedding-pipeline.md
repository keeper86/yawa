# 12 — Embedding pipeline

Depends on: 05, 10, 11. Blocks: 15.

## Decision gate

- Is embedding still synchronous inside a mutation? Yes, bounded: a lecture generates tens of acts, not thousands. A background worker is only justified when a job outlives a request — the creation job in chunk 14 already is one, so it can embed its own output before returning.
- Do we deduplicate identical `script_text` across acts to save calls? Not yet. Measure first; re-generating the same unit is the only likely source of duplicates.

## Deliverables

```
src/server/embed/acts.ts           embedPendingActs, actText, contentHash
src/server/embed/acts.test.ts
src/server/controller/act.ts       embedActs procedure
```

## The unit of work

An act is embedded from `script_text`, which the two helpers from chunk 05 produce (`src/lib/actScript.ts`):

- `actText({ title, script })` — title plus step texts, trimmed, newline separated;
- `actContentHash(text, templateKey, templateVersion)` — sha256 over `"key@version\ntext"`.

They live one chunk earlier than this one because the insert path in chunk 05 needs the same hash: an act's `content_hash` is computed once, at write time, and means exactly one thing.

## Embedding pending acts

```ts
export const embedPendingActs = async (
    ai: AiProvider,
    options: { limit?: number; batchSize?: number; actIds?: string[] } = {},
): Promise<{ embedded: number; remaining: number }>;
```

Rules:

1. **Claim, do not scan.** A transaction selects up to `limit` rows with `FOR UPDATE SKIP LOCKED`, then releases them; the embedding calls happen outside the transaction. Two concurrent requests then never embed the same act, and a long API call never holds row locks.
2. **Batches of 8.** Measured in chunk 01: 2.30 sections/s at batch 8, 2.13 at 16, 1.72 at 32 on 4 vCPU. Larger batches are slower per section, not faster.
3. **Write the model with the vector.** `embedding`, `embedding_model`, `embedded_at` are always written together, so "which model produced this" is never ambiguous.
4. **Re-embedding is triggered by a null embedding, not by `updated_at`.** Any mutation of `script` must set `embedding = NULL` in the same statement. That is the entire invalidation mechanism and it has no second place to go wrong.
5. **Failure is per batch, not per call.** A failed batch leaves those acts unembedded and the loop continues; the caller gets the count and the UI shows "n acts not yet embedded". Never partially write a batch.

## Procedure

`act.embedActs({ lectureId?, limit? })` returns `{ embedded, remaining }`, is owner-scoped, and is called from the creation job and from the lecture page's "finish indexing" action. It is not exposed for arbitrary act ids.

## Acceptance

- [x] `actText` and `actContentHash` are unit-tested; changing the title changes the hash; trailing whitespace does not.
- [x] Embedding several acts calls the provider once per batch and records `embedding_model` and `embedded_at`.
- [x] A second run embeds 0 acts and reports `remaining: 0`.
- [ ] Setting `script` to a new value without clearing `embedding` is impossible through the controller — **not applicable yet**: no procedure updates `script`. When one appears (act editing is an anti-goal, so likely never), it must null the embedding.
- [x] A provider that returns a wrong-length vector aborts with `embeddingDimensionMismatch` and writes nothing.
- [x] With a failing provider on the second batch, the first batch is embedded, the rest stay null, and the return value says so.

## State after execution

Files: `src/server/embed/acts.ts`, `src/server/embed/acts.test.ts` (5 tests), `act.embed` procedure wired into the router.

The claim mechanism from the plan was **dropped**, deliberately. Holding `FOR UPDATE SKIP LOCKED` across the embedding call would keep a transaction and a connection open for seconds per batch. Without it two concurrent runs embed the same act twice and write the same vector twice, which is harmless; the write is guarded by `whereNull('embedding')`, so a second writer cannot clobber a result that already landed. The database stays the source of truth for "has this act been embedded", and nothing needs a claim column.

Failure handling is per batch: a network failure skips the batch and the loop continues; only `embeddingDimensionMismatch` aborts, because that is a configuration error where every further call fails the same way. `remaining` is recounted after the loop rather than computed, so it reflects reality instead of arithmetic.

The bucket "acts with a stale embedding" does not exist yet, because `script` cannot change. `content_hash` is therefore written but only compared by a future reader.

## Anti-goals

- No cron, no queue table, no worker process.
- No incremental "embed on read". Reading never writes.
- No embedding of sources, sections, lectures, transcripts or queries-as-vectors beyond the single query embedding in chunk 15.
