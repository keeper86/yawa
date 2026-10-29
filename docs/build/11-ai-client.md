# 11 — AI client

Depends on: 01. Blocks: 12, 13, 14, 15, 16.

## Decision gate

- Still no SDK? Confirmed: plain `fetch` to an OpenAI-compatible endpoint, one client for chat and embeddings. Adding a provider is then a base URL, not a dependency.
- Is streaming needed? No. The tutoring loop is turn-based; a script arrives whole and is rendered as steps.

## Deliverables

```
src/server/ai/provider.ts          interface, types, getAi()
src/server/ai/openAiCompatible.ts  fetch client with retry and timeout
src/server/ai/fake.ts              deterministic provider for tests
src/server/ai/provider.test.ts     unit tests, no network
```

## Interface

```ts
export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export type ChatOptions = { maxTokens?: number; temperature?: number; effort?: 'low' | 'high' | 'max' };

export type AiProvider = {
    chat(messages: ChatMessage[], options?: ChatOptions): Promise<string>;
    chatStructured<T>(messages: ChatMessage[], schema: z.ZodType<T>, options?: ChatOptions): Promise<T>;
    embed(texts: string[]): Promise<number[][]>;
    readonly embeddingModel: string;
    readonly embeddingDim: number;
};
```

`chatStructured` sends `response_format: { type: 'json_object' }`, parses, validates with zod, and on a validation failure makes **exactly one** repair attempt by appending the zod error to the conversation. A second failure throws `aiInvalidResponse`. Two attempts, never a loop: a model that cannot produce the schema twice will not produce it on the fifth try, and the caller needs a deterministic failure to report to the creator.

## The chat model reasons before it answers

Measured against `deepseek-flash` (DeepSeek-V4.1-Flash, 1 048 576 context, 393 216 max output tokens) during chunk 01:

- Every response carries `reasoning_content` beside `content`. With `max_tokens: 20` the model spent the whole budget thinking and returned `content: ""` with `finish_reason: "length"`. Read `content`; take `reasoning_content` only for its length in logs.
- **An empty `content` with `finish_reason: 'length'` is a failure, not an empty answer.** `chatStructured` must throw `aiInvalidResponse` before zod ever sees `""`, otherwise the single repair attempt is spent on a request that cannot succeed.
- Reasoning tokens are billed and counted in `completion_tokens` (387 reasoning characters cost 148 completion tokens on a one-sentence answer). Defaults are `maxTokens: 4096` for generation and `1024` for grading. A 500-token budget is enough to produce silence.
- `reasoning_effort` accepts `low`, `high` and `max`. Generation uses `high`, grading uses `low`. It is a per-call option rather than an environment variable, because the right level differs between the two calls inside one job.
- `response_format: { "type": "json_object" }` is supported and returns bare JSON without markdown fences.

## Implementation rules

- **Timeout.** `AbortSignal.timeout(60_000)` for chat, `120_000` for embeddings. DeepSeek can be slow under load; a hung request must not hold a tRPC mutation forever.
- **Retry.** Only on `429`, `500`, `502`, `503` and network errors. Three attempts, exponential backoff with jitter (500 ms, 1.5 s, 4.5 s), then `aiUnavailable`. Never retry a `400`; it is our bug and retrying hides it.
- **Logging.** `logger.debug` for request metadata (model, token estimate, duration) and `logger.warn` for retries. Never log prompt or response bodies at `info`; teaching material is personal data.
- **Dimension assertion.** `embed` throws `embeddingDimensionMismatch` if any returned vector length differs from `AI_EMBEDDING_DIM`. Ollama ignores OpenAI's `dimensions` parameter, so a model/config drift would otherwise write mixed-dimension rows and break the index silently.
- **Batching.** `embed` accepts up to 32 texts and rejects more, so callers batch deliberately rather than accidentally building a 500-item request.

## The fake provider

`createFakeProvider({ embeddings?: Map<string, number[]>, chat?: (messages) => string })`.

Two modes, and the distinction matters:

- **Hash mode** (default): a vector derived from `sha256(text)`, unit-normalised. Good for "does the plumbing store something of the right shape", useless for retrieval tests because similarity is arbitrary.
- **Table mode**: explicit `text → vector` entries with a zero-vector fallback. **Retrieval and ranking tests must use table mode**, because they assert specific orderings. A test that asserts "the semantically close act ranks first" cannot be built on hash noise.

The provider is passed as a parameter into services, never imported as a module-level singleton by them. `getAi()` exists only for the tRPC context; tests construct their own.

## Configuration

| Variable                | Used by                  | Example                     |
| ----------------------- | ------------------------ | --------------------------- |
| `AI_CHAT_BASE_URL`      | chat                     | `https://api.deepseek.com`  |
| `AI_CHAT_API_KEY`       | chat                     |                             |
| `AI_CHAT_MODEL`         | chat                     | `deepseek-flash`            |
| `AI_EMBEDDING_BASE_URL` | embeddings               | `http://localhost:11434/v1` |
| `AI_EMBEDDING_API_KEY`  | embeddings               | `ollama`                    |
| `AI_EMBEDDING_MODEL`    | embeddings               | `embeddinggemma`            |
| `AI_EMBEDDING_DIM`      | validation and migration | `768`                       |

Missing configuration throws at construction with the variable name, not a generic failure at the first request.

## Acceptance

- [x] Unit tests cover: success, schema violation then repair succeeds, schema violation twice throws `aiInvalidResponse`, 429 then success, 500 three times throws `aiUnavailable`, 400 throws immediately without retry.
- [x] Empty `content` with `finish_reason: 'length'` throws `aiInvalidResponse` and never reaches the schema: a response truncated after reasoning tokens counts as a failure, not as an empty answer.
- [x] `reasoning_content` is ignored for content and only its length is logged.
- [x] `embed` rejects more than 32 inputs and rejects a vector of the wrong length.
- [x] No test performs a network request: the fetch implementation is injected in every test.
- [x] Logging contains no prompt or response body at `info` or above.

Timeout abort is the one item I did not write a test for. It needs a fetch stub that observes the `AbortSignal`, and asserting `AbortSignal.timeout` fired would test Node, not this code. The signal is passed on every request; if it ever needs a test, stub the fetch to reject with an `AbortError` and assert the retry path treats it as a network error.

## State after execution

Files: `src/server/ai/provider.ts` (types, env config, limits), `src/server/ai/openAiCompatible.ts`, `src/server/ai/fake.ts`, `src/server/ai/index.ts` (`getAi`, lazy singleton), `src/server/ai/provider.test.ts` (16 tests).

Behaviour pinned by tests:

- the default budget is 4096 tokens, and `reasoning_effort` is only sent when asked for — `deepseek-flash` is a reasoning model, so the budget covers thinking _and_ answer;
- an empty answer is a `DomainFailure('aiInvalidResponse')` naming the finish reason, and it never reaches the schema, so the single repair attempt is not spent on a lost cause;
- `chatStructured` repairs once and gives up on the second mismatch, reporting the zod message;
- only 429/500/502/503 retry, with backoff 500 ms → 1.5 s; a 400 surfaces immediately with its body;
- embeddings reject a wrong vector length with `embeddingDimensionMismatch` before anything is stored.

The fake provider has two modes and the difference matters: hash mode gives deterministic unit vectors that prove the plumbing works but carry no meaning, table mode returns vectors a test declared. **Ranking tests must use table mode** — a hash vector cannot support an assertion like "the semantically close act ranks first", and pretending otherwise would produce a green test that measures nothing.

Not wired yet: nothing calls `getAi()`. Chunk 14 is its first consumer, which is also when the fake becomes the default under test.

## Anti-goals

- No provider SDK, no function-calling/tool API, no streaming, no vision.
- No model fallback chain. One model per role, configured.
- No prompt templates in this chunk. Prompts live with their consumer (chunk 14, 15, 16).
