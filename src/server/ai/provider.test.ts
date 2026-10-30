import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createFakeProvider } from './fake';
import type { AiConfig } from './provider';
import { type FetchLike, createAiProvider } from './sdk';
import { collectAiUsage } from './usage';

const config: AiConfig = {
    chatBaseUrl: 'https://chat.example/v1',
    chatApiKey: 'chat-key',
    chatModel: 'deepseek-flash',
    embeddingBaseUrl: 'https://embed.example/v1',
    embeddingApiKey: 'embed-key',
    embeddingModel: 'embeddinggemma',
    embeddingDim: 4,
};

const completion = (content: string, finishReason = 'stop', message: Record<string, unknown> = {}) => ({
    id: 'chatcmpl-1',
    created: 1,
    model: 'deepseek-flash',
    choices: [{ index: 0, message: { role: 'assistant', content, ...message }, finish_reason: finishReason }],
    usage: {
        prompt_tokens: 11,
        completion_tokens: 7,
        total_tokens: 18,
        completion_tokens_details: { reasoning_tokens: 5 },
    },
});

const ok = (body: unknown) => () =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const failing =
    (status: number, text = 'error') =>
    () =>
        new Response(text, { status });

const respondWith = (...responses: (() => Response)[]) => {
    const calls: { url: string; body: Record<string, string | number | unknown> }[] = [];
    let index = 0;
    const fetchImpl: FetchLike = async (input, init) => {
        calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
        const next = responses[Math.min(index, responses.length - 1)];
        index += 1;
        return next();
    };
    return { fetchImpl, calls };
};

const provider = (fetchImpl: FetchLike) => createAiProvider(config, fetchImpl);
const schema = z.object({ ok: z.boolean() });
const ask = [
    { role: 'system' as const, content: 'Antworte knapp.' },
    { role: 'user' as const, content: 'Hi' },
];

describe('structured completions', () => {
    it('parses json that matches the schema', async () => {
        const { fetchImpl, calls } = respondWith(ok(completion('{"ok":true}')));

        expect(await provider(fetchImpl).chatStructured(ask, schema, { label: 'test' })).toEqual({ ok: true });
        expect(calls[0].url).toBe('https://chat.example/v1/chat/completions');
        expect(calls[0].body.model).toBe('deepseek-flash');
        expect(calls[0].body.max_tokens).toBe(16000);
        expect(calls[0].body.response_format).toEqual({ type: 'json_object' });
    });

    it('sends the system prompt first and keeps the conversation order', async () => {
        const { fetchImpl, calls } = respondWith(ok(completion('{"ok":true}')));

        await provider(fetchImpl).chatStructured(ask, schema, { label: 'test' });

        expect(calls[0].body.messages).toEqual([
            { role: 'system', content: 'Antworte knapp.' },
            { role: 'user', content: 'Hi' },
        ]);
    });

    it('sends the budget and the reasoning effort per call', async () => {
        const { fetchImpl, calls } = respondWith(ok(completion('{"ok":true}')));

        await provider(fetchImpl).chatStructured(ask, schema, { label: 'test', effort: 'low', maxTokens: 128 });

        expect(calls[0].body.max_tokens).toBe(128);
        expect(calls[0].body.reasoning_effort).toBe('low');
    });

    it('repairs once and succeeds', async () => {
        const { fetchImpl, calls } = respondWith(ok(completion('{"ok":"ja"}')), ok(completion('{"ok":true}')));

        expect(await provider(fetchImpl).chatStructured(ask, schema, { label: 'test' })).toEqual({ ok: true });
        expect(calls).toHaveLength(2);
        expect(calls[1].body.messages).toHaveLength(4);
        expect(String((calls[1].body.messages as { content: string }[])[3].content)).toMatch(/did not match/);
    });

    it('gives up after one repair', async () => {
        const { fetchImpl, calls } = respondWith(ok(completion('{"ok":"ja"}')), ok(completion('{"ok":"nein"}')));

        await expect(provider(fetchImpl).chatStructured(ask, schema, { label: 'plan-lesson' })).rejects.toThrow(
            /plan-lesson did not produce/,
        );
        expect(calls).toHaveLength(2);
    });

    it('rejects unparsable json', async () => {
        const { fetchImpl } = respondWith(ok(completion('kein json')), ok(completion('kein json')));

        await expect(provider(fetchImpl).chatStructured(ask, schema, { label: 'test' })).rejects.toThrow(
            /did not produce/,
        );
    });

    it('reports an answer that spent the budget on reasoning, and still counts its tokens', async () => {
        const { fetchImpl, calls } = respondWith(
            ok(completion('', 'length', { reasoning_content: 'langes Nachdenken' })),
        );

        const { usage } = await collectAiUsage(async () => {
            await expect(provider(fetchImpl).chatStructured(ask, schema, { label: 'test' })).rejects.toThrow(
                /no output/,
            );
        });

        expect(calls).toHaveLength(1);
        expect(usage.calls).toBe(1);
        expect(usage.reasoningTokens).toBe(5);
    });

    it('surfaces an api error with its status', async () => {
        const { fetchImpl } = respondWith(failing(400, 'bad model'));

        await expect(provider(fetchImpl).chatStructured(ask, schema, { label: 'test' })).rejects.toThrow(/400/);
    });
});

describe('usage', () => {
    it('counts the tokens of a successful call', async () => {
        const { fetchImpl } = respondWith(ok(completion('{"ok":true}')));

        const { usage } = await collectAiUsage(() =>
            provider(fetchImpl).chatStructured(ask, schema, { label: 'test' }),
        );

        expect(usage).toEqual({ calls: 1, inputTokens: 11, outputTokens: 7, reasoningTokens: 5, totalTokens: 18 });
    });

    it('counts the tokens of an attempt that failed the schema', async () => {
        const { fetchImpl } = respondWith(ok(completion('{"ok":"ja"}')), ok(completion('{"ok":true}')));

        const { usage } = await collectAiUsage(() =>
            provider(fetchImpl).chatStructured(ask, schema, { label: 'test' }),
        );

        expect(usage.calls).toBe(2);
        expect(usage.totalTokens).toBe(36);
    });

    it('counts the tokens of an embedding batch', async () => {
        const { fetchImpl } = respondWith(
            ok({ model: 'embeddinggemma', data: [{ embedding: [1, 0, 0, 0], index: 0 }], usage: { prompt_tokens: 4 } }),
        );

        const { usage } = await collectAiUsage(() => provider(fetchImpl).embed(['a']));

        expect(usage).toEqual({ calls: 1, inputTokens: 4, outputTokens: 0, reasoningTokens: 0, totalTokens: 4 });
    });
});

describe('retry policy', () => {
    it('retries a rate limit and succeeds', async () => {
        const { fetchImpl, calls } = respondWith(failing(429), ok(completion('{"ok":true}')));

        expect(await provider(fetchImpl).chatStructured(ask, schema, { label: 'test' })).toEqual({ ok: true });
        expect(calls).toHaveLength(2);
    }, 20_000);

    it('does not retry a bad request', async () => {
        const { fetchImpl, calls } = respondWith(failing(400, 'bad model'));

        await expect(provider(fetchImpl).chatStructured(ask, schema, { label: 'test' })).rejects.toThrow(/400/);
        expect(calls).toHaveLength(1);
    });
});

describe('embeddings', () => {
    it('returns one vector per input', async () => {
        const { fetchImpl, calls } = respondWith(
            ok({
                model: 'embeddinggemma',
                data: [
                    { embedding: [1, 0, 0, 0], index: 0 },
                    { embedding: [0, 1, 0, 0], index: 1 },
                ],
                usage: { prompt_tokens: 4 },
            }),
        );

        const vectors = await provider(fetchImpl).embed(['a', 'b']);

        expect(vectors).toEqual([
            [1, 0, 0, 0],
            [0, 1, 0, 0],
        ]);
        expect(calls[0].url).toBe('https://embed.example/v1/embeddings');
        expect(calls[0].body.model).toBe('embeddinggemma');
    });

    it('refuses a batch above the limit without calling the endpoint', async () => {
        const { fetchImpl, calls } = respondWith(ok({ data: [] }));

        await expect(provider(fetchImpl).embed(Array.from({ length: 33 }, () => 'x'))).rejects.toThrow(/exceeds/);
        expect(calls).toHaveLength(0);
    });

    it('refuses a vector of the wrong dimension', async () => {
        const { fetchImpl } = respondWith(
            ok({ model: 'embeddinggemma', data: [{ embedding: [1, 0, 0], index: 0 }], usage: { prompt_tokens: 1 } }),
        );

        await expect(provider(fetchImpl).embed(['a'])).rejects.toThrow(/dimensions/);
    });
});

describe('fake provider', () => {
    it('produces deterministic unit vectors', async () => {
        const fake = createFakeProvider({ embeddingDim: 8 });

        const [first] = await fake.embed(['gleicher Text']);
        const [second] = await fake.embed(['gleicher Text']);

        expect(first).toEqual(second);
        expect(first).toHaveLength(8);
        expect(Math.sqrt(first.reduce((sum, value) => sum + value * value, 0))).toBeCloseTo(1);
    });

    it('prefers an explicit vector table over the hash', async () => {
        const fake = createFakeProvider({ embeddingDim: 3, embeddings: new Map([['nah', [1, 0, 0]]]) });

        expect(await fake.embed(['nah', 'anderes'])).toEqual([[1, 0, 0], expect.any(Array)]);
    });

    it('refuses to invent an answer without a handler', async () => {
        await expect(createFakeProvider().chatStructured(ask, schema, { label: 'test' })).rejects.toThrow(
            /without a handler/,
        );
    });
});
