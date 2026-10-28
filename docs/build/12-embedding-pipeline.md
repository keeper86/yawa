# 12 — Embedding pipeline

Depends on: 05, 10, 11. Blocks: 15.

## Decision gate

- Is embedding still synchronous inside a mutation? Yes, bounded: a lecture generates tens of acts, not thousands. A background worker is only justified when a job outlives a request — the creation job in chunk 14 already is one, so it can embed its own output before returning.
- Do we deduplicate identical `script_text` across acts to save calls? Not yet. Measure first; imported acts are the only likely duplicates.

## Deliverables

```
src/server/embed/acts.ts           embedPendingActs, actText, contentHash
src/server/embed/acts.test.ts
src/server/controller/act.ts       embedActs procedure
```

## The unit of work

An act is embedded from `script_text`, which is produced by one function:

```ts
export const actText = (act: { title: string; script: { steps: { text: string }[] } }): string =>
    [act.title, ...act.script.steps.map((step) => step.text)].join('\n');

export const actContentHash = (text: string, templateKey: string, templateVersion: number): string =>
    createHash('sha256').update(`${templateKey}@${templateVersion}\n${text}`).digest('hex');
```

Both are shared with chunk 05's insert path, so an act's hash is computed once and means one thing.

## Embedding pending acts

```ts
export const embedPendingActs = async (
    ai: AiProvider,
    options: { limit?: number; batchSize?: number; actIds?: string[] } = {},
): Promise<{ embedded: number; remaining: number }>;
```

Rules:

1. **Claim, do not scan.** A transaction selects up to `limit` rows with `FOR UPDATE SKIP LOCKED`, then releases them; the embedding calls happen outside the transaction. Two concurrent requests then never embed the same act, and a long API call never holds row locks.
2. **Batches of 16.** Ollama's throughput is per-request; larger batches buy little and slow the first progress tick.
3. **Write the model with the vector.** `embedding`, `embedding_model`, `embedded_at` are always written together, so "which model produced this" is never ambiguous.
4. **Re-embedding is triggered by a null embedding, not by `updated_at`.** Any mutation of `script` must set `embedding = NULL` in the same statement. That is the entire invalidation mechanism and it has no second place to go wrong.
5. **Failure is per batch, not per call.** A failed batch leaves those acts unembedded and the loop continues; the caller gets the count and the UI shows "n acts not yet embedded". Never partially write a batch.

## Procedure

`act.embedActs({ lectureId?, limit? })` returns `{ embedded, remaining }`, is owner-scoped, and is called from the creation job and from the lecture page's "finish indexing" action. It is not exposed for arbitrary act ids.

## Acceptance

- [ ] `actText` and `actContentHash` are unit-tested; changing the title changes the hash; trailing whitespace does not.
- [ ] Embedding 3 acts calls the provider exactly once, with 3 inputs.
- [ ] A second run embeds 0 acts and reports `remaining: 0`.
- [ ] Setting `script` to a new value without clearing `embedding` is impossible through the controller (test: the update path nulls it).
- [ ] A provider that returns a wrong-length vector aborts with `embeddingDimensionMismatch` and writes nothing.
- [ ] With 40 pending acts and a failing provider on the second batch, acts 1–16 are embedded, the rest stay null, and the return value says so.

## Anti-goals

- No cron, no queue table, no worker process.
- No incremental "embed on read". Reading never writes.
- No embedding of sources, sections, lectures, transcripts or queries-as-vectors beyond the single query embedding in chunk 15.
