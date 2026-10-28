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

export type AiProvider = {
    chat(messages: ChatMessage[], options?: { maxTokens?: number; temperature?: number }): Promise<string>;
    chatStructured<T>(messages: ChatMessage[], schema: z.ZodType<T>): Promise<T>;
    embed(texts: string[]): Promise<number[][]>;
    readonly embeddingModel: string;
    readonly embeddingDim: number;
};
```

`chatStructured` sends `response_format: { type: 'json_object' }`, parses, validates with zod, and on a validation failure makes **exactly one** repair attempt by appending the zod error to the conversation. A second failure throws `aiInvalidResponse`. Two attempts, never a loop: a model that cannot produce the schema twice will not produce it on the fifth try, and the caller needs a deterministic failure to report to the creator.

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

- [ ] Unit tests cover: success, schema violation then repair succeeds, schema violation twice throws `aiInvalidResponse`, 429 then success, 500 three times throws `aiUnavailable`, 400 throws immediately without retry, timeout aborts.
- [ ] `embed` rejects more than 32 inputs and rejects a vector of the wrong length.
- [ ] No test performs a network request (`fetch` is stubbed or the fake is used; assert zero calls to global fetch where relevant).
- [ ] Logging contains no prompt or response body at `info` or above.

## Anti-goals

- No provider SDK, no function-calling/tool API, no streaming, no vision.
- No model fallback chain. One model per role, configured.
- No prompt templates in this chunk. Prompts live with their consumer (chunk 14, 15, 16).
