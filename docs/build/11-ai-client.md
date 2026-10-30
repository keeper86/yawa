# 11 — AI client

Depends on: 01. Blocks: 12, 13, 14, 15, 16.

## Decision gate

- **SDK or hand-rolled fetch?** Hand-rolled first (chunks 01–18 built the platform without one), then swapped for the Vercel AI SDK once the plumbing was proven. The transport was never the hard part; the argument for the SDK is what it brings for free: per-call token accounting, retry with jitter, provider warnings, and a mock model for tests. The abstraction above it (`AiProvider`) did not change shape, so the swap touched one file.
- Is streaming needed? No. The tutoring loop is turn-based; a script arrives whole and is rendered as steps. The SDK is used through `generateText`, not `streamText`.

## Deliverables

```
src/server/ai/provider.ts    interface, types, env config, aiConfigFromEnv()
src/server/ai/sdk.ts         AI SDK client (chat + embeddings), warnings routed to pino
src/server/ai/usage.ts       AiCallUsage, AsyncLocalStorage totals, aiUsageTotalsSchema
src/server/ai/fake.ts        deterministic provider for tests
src/server/ai/provider.test.ts  unit tests, no network
```

## Interface

```ts
export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export type ChatOptions = { label: string; maxTokens?: number; temperature?: number; effort?: 'low' | 'high' | 'max' };

export type AiProvider = {
    chatStructured<T>(messages: ChatMessage[], schema: z.ZodType<T>, options: ChatOptions): Promise<T>;
    embed(texts: string[]): Promise<number[][]>;
    readonly embeddingModel: string;
    readonly embeddingDim: number;
};
```

`label` is required and names the operation (`plan-lesson`, `grade-answer`, `generate-act`). It is the only thing that makes a token log readable six hours later, so it is not optional and not derived from the call site.

There is no `chat(messages) => string`. It existed and nothing called it: every consumer wants a validated object, and an unvalidated string is exactly the shape that let the lesson renderer pass rubrics to learners. Removed rather than kept for a hypothetical stream.

`chatStructured` calls `generateText` with `output: Output.object({ schema })`, `maxOutputTokens`, and `providerOptions: { yawa: { reasoningEffort } }`. System messages are lifted out of `messages` into `instructions`; the rest go through as conversation turns. On a schema mismatch the SDK throws `NoObjectGeneratedError` and the client makes **exactly one** repair attempt by appending the model's own text and the validation error. Two attempts, never a loop: a model that cannot produce the schema twice will not produce it on the fifth try, and the caller needs a deterministic failure.

`Output.object` with a provider that is not declared `supportsStructuredOutputs` sends `response_format: { type: 'json_object' }` — bare JSON, no schema enforcement, no markdown fences. That is what DeepSeek accepts. The SDK warns about the dropped schema on every call; the warning goes to `logger.debug` through `globalThis.AI_SDK_LOG_WARNINGS` rather than to stderr on every request.

## The chat model reasons before it answers

Measured against `deepseek-flash` (DeepSeek-V4.1-Flash, 1 048 576 context, 393 216 max output tokens) during chunk 01:

- Every response carries `reasoning_content` beside `content`. With `max_tokens: 20` the model spent the whole budget thinking and returned `content: ""` with `finish_reason: "length"`. The SDK maps `reasoning_content` to a reasoning part, so it never reaches the JSON parser.
- **An empty answer is a failure, not an empty result.** The SDK throws `NoOutputGeneratedError`; the client turns that into `aiInvalidResponse` with "the budget may have gone to reasoning, raise maxTokens" and does not spend the repair attempt.
- Reasoning tokens are billed and counted in `completion_tokens`. On a real `plan-lesson` call: 1 151 prompt tokens, 9 377 completion tokens of which **7 759 were reasoning**, 51.7 s wall clock. Defaults are `maxTokens: 16000` for generation/planning, `8000` for repair and `1024` for grading.
- `reasoning_effort` accepts `low`, `high` and `max`, passed as `providerOptions.yawa.reasoningEffort`. Generation uses `high`, grading uses `low`. It is a per-call option rather than an environment variable, because the right level differs between the two calls inside one job.

## Token accounting

Every model call and every embedding batch reports what it cost:

```
INFO ai usage  label: "plan-lesson"  inputTokens: 1151  outputTokens: 9377
               reasoningTokens: 7759  totalTokens: 10528  ms: 51662
```

The numbers come from `onLanguageModelCallEnd`, which fires once per provider call — **including calls whose output then fails the schema**. That is deliberate: the most expensive call in the system is the one that spends 15 000 tokens reasoning and returns nothing, and a usage hook on the success path alone would report exactly that call as free.

`collectAiUsage(fn)` adds every recorded call to an `AsyncLocalStorage` total, so a job can price itself without threading a counter through five function signatures:

```ts
const { result, usage } = await collectAiUsage(() => runGeneration());
// usage: { calls, inputTokens, outputTokens, reasoningTokens, totalTokens }
```

`creation_jobs.usage` (JSONB) stores that total; the plan tab shows `3 model calls · 12.4k in / 3.1k out`. Nested calls land in the same total because the store is per async context, not per function call — act generation and the embedding pass that follows it both count.

## Implementation rules

- **Timeout.** `AbortSignal.timeout(120_000)` per model call and per embedding batch. A hung request must not hold a tRPC mutation forever, and a retry loop budget must not outlive the request.
- **Retry.** The SDK does it: `maxRetries: 2`, exponential backoff with jitter, only on 429/408/5xx and network errors. Never on a 400 — that is our bug and retrying hides it. The old hand-rolled loop (three attempts, 500 ms → 1.5 s) is gone together with its 400-vs-500 test split; what remains is a test that a 429 is retried and a 400 is not.
- **Logging.** `logger.info` carries the usage numbers (`label`, `model`, `finishReason`, tokens, `ms`). Prompt and response bodies never reach `info`; teaching material is personal data.
- **Dimension assertion.** `embed` throws `embeddingDimensionMismatch` if any returned vector length differs from `AI_EMBEDDING_DIM`. Ollama ignores OpenAI's `dimensions` parameter, so a model/config drift would otherwise write mixed-dimension rows and break the index silently.
- **Batching.** `embed` accepts up to 32 texts and rejects more, so callers batch deliberately rather than accidentally building a 500-item request.

## The fake provider

`createFakeProvider({ embeddings?: Map<string, number[]>, structured?: (messages, options) => unknown })`. The structured handler also records a usage entry, so a job wrapped in `collectAiUsage` reports calls under test instead of zero.

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

- [x] Tests cover: valid JSON, schema violation then repair succeeds, schema violation twice throws `aiInvalidResponse`, a 429 is retried, a 400 is not.
- [x] An answer that spent the budget on reasoning throws `aiInvalidResponse` with "no output" and never reaches the schema, so the repair attempt is not spent on a lost cause.
- [x] `reasoning_content` is never parsed as content; it arrives as a reasoning part.
- [x] Every call and every embedding batch records its tokens, including calls that fail the schema afterwards.
- [x] `embed` rejects more than 32 inputs and rejects a vector of the wrong length.
- [x] No test performs a network request: the fetch implementation is injected in every test.
- [x] Logging contains no prompt or response body at `info` or above.

## State after execution

Files: `src/server/ai/provider.ts` (types, env config, limits), `src/server/ai/sdk.ts` (AI SDK transport), `src/server/ai/usage.ts` (token accounting), `src/server/ai/fake.ts`, `src/server/ai/index.ts` (`getAi`, lazy singleton), `src/server/ai/provider.test.ts` (19 tests).

Behaviour pinned by tests:

- the default budget is 16 000 tokens, and `reasoning_effort` is only sent when asked for — `deepseek-flash` is a reasoning model, so the budget covers thinking _and_ answer;
- the system prompt arrives as the first message, ahead of the conversation turns, because it is lifted out of `messages` into `instructions` before the call;
- `chatStructured` repairs once and gives up on the second mismatch, reporting the validation message;
- an answer that is only reasoning throws `aiInvalidResponse`, and its tokens are still counted;
- embeddings reject a wrong vector length with `embeddingDimensionMismatch` before anything is stored;
- the fake provider reports one usage entry per structured call.

The fake provider has two modes and the difference matters: hash mode gives deterministic unit vectors that prove the plumbing works but carry no meaning, table mode returns vectors a test declared. **Ranking tests must use table mode** — a hash vector cannot support an assertion like "the semantically close act ranks first", and pretending otherwise would produce a green test that measures nothing.

Measured against the live endpoints after the swap: one `plan-lesson` call cost 10 528 tokens (1 151 in / 9 377 out, 7 759 of them reasoning) in 51.7 s and produced a five-bead lesson; one embedding batch of two texts cost 18 tokens in 849 ms.

## Anti-goals

- No tool/function-calling API, no streaming, no vision, no model fallback chain. The SDK is present for accounting and transport, not to move the agent loop into it: planning and generation stay plain `chatStructured` calls whose output we validate.
- No model fallback chain. One model per role, configured.
- No prompt templates in this chunk. Prompts live with their consumer (chunk 14, 15, 16).
