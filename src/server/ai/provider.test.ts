import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createFakeProvider } from './fake';
import { type FetchLike, createOpenAiCompatibleProvider } from './openAiCompatible';
import type { AiConfig } from './provider';

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
    choices: [{ message: { content, ...message }, finish_reason: finishReason }],
});

const ok = (body: unknown) => () =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const failing =
    (status: number, text = 'error') =>
    () =>
        new Response(text, { status });

const respondWith = (...responses: (() => Response)[]) => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    let index = 0;
    const fetchImpl: FetchLike = async (url, init) => {
        calls.push({ url, body: JSON.parse(String(init.body)) });
        const next = responses[Math.min(index, responses.length - 1)];
        index += 1;
        return next();
    };
    return { fetchImpl, calls };
};

const provider = (fetchImpl: FetchLike) => createOpenAiCompatibleProvider(config, fetchImpl);

describe('chat completions', () => {
    it('returns the content', async () => {
        const { fetchImpl } = respondWith(ok(completion('Hallo')));

        expect(await provider(fetchImpl).chat([{ role: 'user', content: 'Hi' }])).toBe('Hallo');
    });

    it('sends the model, the default token budget and the optional effort', async () => {
        const { fetchImpl, calls } = respondWith(ok(completion('ok')), ok(completion('ok')));

        await provider(fetchImpl).chat([{ role: 'user', content: 'Hi' }]);
        await provider(fetchImpl).chat([{ role: 'user', content: 'Hi' }], { maxTokens: 128, effort: 'low' });

        expect(calls[0].url).toBe('https://chat.example/v1/chat/completions');
        expect(calls[0].body.model).toBe('deepseek-flash');
        expect(calls[0].body.max_tokens).toBe(4096);
        expect(calls[0].body.reasoning_effort).toBeUndefined();
        expect(calls[1].body.max_tokens).toBe(128);
        expect(calls[1].body.reasoning_effort).toBe('low');
    });

    it('treats an empty answer after reasoning as a failure', async () => {
        const { fetchImpl } = respondWith(ok(completion('', 'length', { reasoning_content: 'langes Nachdenken' })));

        await expect(provider(fetchImpl).chat([{ role: 'user', content: 'Hi' }])).rejects.toThrow(/no content/);
    });
});

describe('structured completions', () => {
    const schema = z.object({ ok: z.boolean() });

    it('parses json that matches the schema', async () => {
        const { fetchImpl, calls } = respondWith(ok(completion('{"ok":true}')));

        expect(await provider(fetchImpl).chatStructured([{ role: 'user', content: 'Hi' }], schema)).toEqual({
            ok: true,
        });
        expect(calls[0].body.response_format).toEqual({ type: 'json_object' });
    });

    it('repairs once and succeeds', async () => {
        const { fetchImpl, calls } = respondWith(ok(completion('{"ok":"ja"}')), ok(completion('{"ok":true}')));

        expect(await provider(fetchImpl).chatStructured([{ role: 'user', content: 'Hi' }], schema)).toEqual({
            ok: true,
        });
        expect(calls).toHaveLength(2);
    });

    it('gives up after one repair', async () => {
        const { fetchImpl, calls } = respondWith(ok(completion('{"ok":"ja"}')), ok(completion('{"ok":"nein"}')));

        await expect(provider(fetchImpl).chatStructured([{ role: 'user', content: 'Hi' }], schema)).rejects.toThrow(
            /did not produce/,
        );
        expect(calls).toHaveLength(2);
    });

    it('rejects unparsable json', async () => {
        const { fetchImpl } = respondWith(ok(completion('kein json')), ok(completion('kein json')));

        await expect(provider(fetchImpl).chatStructured([{ role: 'user', content: 'Hi' }], schema)).rejects.toThrow(
            /invalid JSON|did not produce/,
        );
    });
});

describe('retry policy', () => {
    it('retries a rate limit and succeeds', async () => {
        const { fetchImpl, calls } = respondWith(failing(429), ok(completion('endlich')));

        expect(await provider(fetchImpl).chat([{ role: 'user', content: 'Hi' }])).toBe('endlich');
        expect(calls).toHaveLength(2);
    });

    it('gives up after three server errors', async () => {
        const { fetchImpl, calls } = respondWith(failing(500), failing(502), failing(503));

        await expect(provider(fetchImpl).chat([{ role: 'user', content: 'Hi' }])).rejects.toThrow(/after 3 attempts/);
        expect(calls).toHaveLength(3);
    });

    it('does not retry a bad request', async () => {
        const { fetchImpl, calls } = respondWith(failing(400, 'bad model'));

        await expect(provider(fetchImpl).chat([{ role: 'user', content: 'Hi' }])).rejects.toThrow(/400/);
        expect(calls).toHaveLength(1);
    });
});

describe('embeddings', () => {
    it('returns one vector per input', async () => {
        const { fetchImpl, calls } = respondWith(
            ok({
                data: [{ embedding: [1, 0, 0, 0] }, { embedding: [0, 1, 0, 0] }],
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
        const { fetchImpl } = respondWith(ok({ data: [{ embedding: [1, 0, 0] }] }));

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

    it('refuses to invent a chat answer without a handler', async () => {
        await expect(createFakeProvider().chat([{ role: 'user', content: 'Hi' }])).rejects.toThrow(/without a handler/);
    });
});
