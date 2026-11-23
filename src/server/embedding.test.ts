import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    EMBEDDING_BATCH_SIZE,
    EMBEDDING_KEEP_ALIVE,
    EMBEDDING_MAX_ATTEMPTS,
    EMBEDDING_MODEL,
    EMBEDDING_RETRY_DELAY_MS,
    EMBEDDING_TIMEOUT_MS,
    EmbeddingError,
    embedDocument,
    embedDocuments,
    embedQuery,
    embedText,
    embedTexts,
} from './embedding';

const vector = Array.from({ length: 768 }, (_, index) => index / 768);

const expectedBody = (input: unknown) =>
    JSON.stringify({
        model: EMBEDDING_MODEL,
        input,
        truncate: false,
        keep_alive: EMBEDDING_KEEP_ALIVE,
    });

function respond(body: unknown, status = 200) {
    return vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(body), { status }))),
    );
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
});

describe('embedText', () => {
    it.each(['Hello world', '', '   \n\t', '  Ünicode\ntext  '])(
        'preserves input %j and returns only the vector',
        async (text) => {
            respond({ embeddings: [vector], model: EMBEDDING_MODEL, total_duration: 123 });
            vi.stubEnv('OLLAMA_BASE_URL', 'http://embedding.internal:11434/');

            expect(await embedText(text)).toEqual(vector);
            expect(fetch).toHaveBeenCalledExactlyOnceWith(new URL('http://embedding.internal:11434/api/embed'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: expectedBody(text),
                signal: expect.any(AbortSignal),
            });
        },
    );

    it('defaults to localhost when the service address is unset', async () => {
        vi.stubEnv('OLLAMA_BASE_URL', undefined);
        respond({ embeddings: [vector] });
        await embedText('text');
        expect(vi.mocked(fetch).mock.calls[0][0].toString()).toBe('http://127.0.0.1:11434/api/embed');
    });

    it('requires OLLAMA_BASE_URL in production', async () => {
        vi.stubEnv('NODE_ENV', 'production');
        vi.stubEnv('OLLAMA_BASE_URL', undefined);
        const request = vi.fn();
        vi.stubGlobal('fetch', request);

        await expect(embedText('text')).rejects.toMatchObject({
            name: 'EmbeddingError',
            message: 'OLLAMA_BASE_URL is not configured.',
            status: undefined,
        });
        expect(request).not.toHaveBeenCalled();
    });

    it.each([null, undefined, 123, {}, ['text']])('rejects non-string input %j without a request', async (text) => {
        const request = vi.fn();
        vi.stubGlobal('fetch', request);
        await expect(embedText(text as string)).rejects.toThrow(TypeError);
        expect(request).not.toHaveBeenCalled();
    });

    it('preserves transport failures after retrying', async () => {
        vi.useFakeTimers();
        const cause = new TypeError('Connection refused');
        const request = vi.fn().mockRejectedValue(cause);
        vi.stubGlobal('fetch', request);

        const result = embedText('text');
        const assertion = expect(result).rejects.toMatchObject({
            name: 'EmbeddingError',
            cause,
            status: undefined,
        });
        await vi.advanceTimersByTimeAsync(EMBEDDING_RETRY_DELAY_MS * EMBEDDING_MAX_ATTEMPTS);
        await assertion;
        expect(request).toHaveBeenCalledTimes(EMBEDDING_MAX_ATTEMPTS);
    });

    it.each([400, 404, 429, 500, 503])(
        'preserves HTTP status %i and the error body without exposing it in the message',
        async (status) => {
            const retryable = status === 429 || status >= 500;
            if (retryable) {
                vi.useFakeTimers();
            }
            const body = { error: 'service detail' };
            respond(body, status);

            const result = embedText('private text');
            const assertion = expect(result).rejects.toMatchObject({
                name: 'EmbeddingError',
                message: 'Embedding service rejected the request.',
                status,
                cause: JSON.stringify(body),
            });
            if (retryable) {
                await vi.advanceTimersByTimeAsync(EMBEDDING_RETRY_DELAY_MS * EMBEDDING_MAX_ATTEMPTS);
            }
            await assertion;
            expect(fetch).toHaveBeenCalledTimes(retryable ? EMBEDDING_MAX_ATTEMPTS : 1);
        },
    );

    it('preserves invalid JSON errors and the successful HTTP status', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('invalid json')));
        await expect(embedText('text')).rejects.toMatchObject({
            name: 'EmbeddingError',
            message: 'Embedding service returned invalid JSON.',
            status: 200,
            cause: expect.any(SyntaxError),
        });
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it.each([
        null,
        {},
        { embeddings: [] },
        { embeddings: [[]] },
        { embeddings: [vector, vector] },
        { embeddings: [vector.slice(1)] },
        { embeddings: [[...vector, 0]] },
        { embeddings: [{ length: 768 }] },
        { embeddings: [vector.map(() => '1')] },
        { embeddings: [vector.map(() => null)] },
    ])('rejects invalid vector responses %#', async (body) => {
        respond(body);
        await expect(embedText('')).rejects.toThrow('Embedding service returned an invalid vector.');
    });

    it.each([NaN, Infinity, -Infinity])('rejects nonfinite components %s', async (value) => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => ({ embeddings: [[value, ...vector.slice(1)]] }),
            }),
        );
        await expect(embedText('text')).rejects.toBeInstanceOf(EmbeddingError);
    });

    it.each(['connection', 'body', 'error body'])('bounds the entire request while waiting for %s', async (phase) => {
        vi.useFakeTimers();
        const pending = new Promise(() => {});
        vi.stubGlobal(
            'fetch',
            vi.fn().mockImplementation(() =>
                phase === 'connection'
                    ? pending
                    : Promise.resolve({
                          ok: phase === 'body',
                          status: phase === 'body' ? 200 : 503,
                          json: () => pending,
                          text: () => pending,
                      }),
            ),
        );
        const result = embedText('private text');
        const assertion = expect(result).rejects.toMatchObject({
            name: 'EmbeddingError',
            message: 'Embedding request timed out.',
            status: phase === 'connection' ? undefined : phase === 'body' ? 200 : 503,
            cause: expect.objectContaining({ name: 'TimeoutError' }),
        });
        await vi.advanceTimersByTimeAsync(EMBEDDING_TIMEOUT_MS);
        await assertion;
        expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
        expect(vi.mocked(fetch).mock.calls[0][1]?.signal?.aborted).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('clears the request timer after success', async () => {
        vi.useFakeTimers();
        respond({ embeddings: [vector] });
        await embedText('text');
        expect(vi.getTimerCount()).toBe(0);
    });
});

describe('embedTexts', () => {
    const reversed = [...vector].reverse();

    it('sends one request and preserves the input order', async () => {
        vi.stubEnv('OLLAMA_BASE_URL', 'http://embedding.internal:11434/');
        respond({ embeddings: [vector, reversed] });

        await expect(embedTexts(['first', 'second'])).resolves.toEqual([vector, reversed]);
        expect(fetch).toHaveBeenCalledExactlyOnceWith(new URL('http://embedding.internal:11434/api/embed'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: expectedBody(['first', 'second']),
            signal: expect.any(AbortSignal),
        });
    });

    it('splits input into batches and returns every vector in order', async () => {
        const texts = Array.from({ length: EMBEDDING_BATCH_SIZE * 2 + 1 }, (_, index) => `text ${index}`);
        const request = vi.fn();
        for (const size of [EMBEDDING_BATCH_SIZE, EMBEDDING_BATCH_SIZE, 1]) {
            request.mockResolvedValueOnce(
                new Response(JSON.stringify({ embeddings: Array.from({ length: size }, () => vector) })),
            );
        }
        vi.stubGlobal('fetch', request);

        const result = await embedTexts(texts);

        expect(result).toHaveLength(texts.length);
        expect(request).toHaveBeenCalledTimes(3);
        expect(request.mock.calls.map((call) => JSON.parse(call[1]?.body as string).input)).toEqual([
            texts.slice(0, EMBEDDING_BATCH_SIZE),
            texts.slice(EMBEDDING_BATCH_SIZE, EMBEDDING_BATCH_SIZE * 2),
            texts.slice(EMBEDDING_BATCH_SIZE * 2),
        ]);
    });

    it('returns no vectors for an empty input without a request', async () => {
        const request = vi.fn();
        vi.stubGlobal('fetch', request);

        await expect(embedTexts([])).resolves.toEqual([]);
        expect(request).not.toHaveBeenCalled();
    });

    it.each([null, undefined, 'text', 123, {}, ['valid', 1], new Array(2)])(
        'rejects invalid input %j without a request',
        async (texts) => {
            const request = vi.fn();
            vi.stubGlobal('fetch', request);

            await expect(embedTexts(texts as string[])).rejects.toThrow(TypeError);
            expect(request).not.toHaveBeenCalled();
        },
    );

    it('rejects when the service returns a different number of vectors', async () => {
        respond({ embeddings: [vector] });

        await expect(embedTexts(['first', 'second'])).rejects.toThrow('Embedding service returned an invalid vector.');
    });

    it('rejects when any vector in a batch is invalid', async () => {
        respond({ embeddings: [vector, vector.slice(1)] });

        await expect(embedTexts(['first', 'second'])).rejects.toBeInstanceOf(EmbeddingError);
    });

    it('bounds a batch request with the same timeout', async () => {
        vi.useFakeTimers();
        vi.stubGlobal(
            'fetch',
            vi.fn().mockImplementation(() => new Promise(() => {})),
        );

        const result = embedTexts(['first', 'second']);
        const assertion = expect(result).rejects.toMatchObject({
            name: 'EmbeddingError',
            message: 'Embedding request timed out.',
            status: undefined,
            cause: expect.objectContaining({ name: 'TimeoutError' }),
        });
        await vi.advanceTimersByTimeAsync(EMBEDDING_TIMEOUT_MS);
        await assertion;
        expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });
});

describe('retries', () => {
    it('retries a transport failure and succeeds', async () => {
        vi.useFakeTimers();
        const request = vi
            .fn()
            .mockRejectedValueOnce(new TypeError('Connection refused'))
            .mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify({ embeddings: [vector] }))));
        vi.stubGlobal('fetch', request);

        const result = embedText('text');
        await vi.advanceTimersByTimeAsync(EMBEDDING_RETRY_DELAY_MS);
        await expect(result).resolves.toEqual(vector);
        expect(request).toHaveBeenCalledTimes(2);
    });

    it('retries a server error and succeeds', async () => {
        vi.useFakeTimers();
        const request = vi
            .fn()
            .mockImplementationOnce(() => Promise.resolve(new Response('busy', { status: 503 })))
            .mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify({ embeddings: [vector] }))));
        vi.stubGlobal('fetch', request);

        const result = embedText('text');
        await vi.advanceTimersByTimeAsync(EMBEDDING_RETRY_DELAY_MS);
        await expect(result).resolves.toEqual(vector);
        expect(request).toHaveBeenCalledTimes(2);
    });

    it('does not retry a client error', async () => {
        const request = vi.fn().mockImplementation(() => Promise.resolve(new Response('bad', { status: 400 })));
        vi.stubGlobal('fetch', request);

        await expect(embedText('text')).rejects.toMatchObject({ status: 400 });
        expect(request).toHaveBeenCalledTimes(1);
    });

    it('uses increasing backoff before giving up', async () => {
        vi.useFakeTimers();
        const request = vi.fn().mockRejectedValue(new TypeError('Connection refused'));
        vi.stubGlobal('fetch', request);

        const result = embedText('text');
        const assertion = expect(result).rejects.toBeInstanceOf(EmbeddingError);
        await vi.advanceTimersByTimeAsync(EMBEDDING_RETRY_DELAY_MS - 1);
        expect(request).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(request).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(EMBEDDING_RETRY_DELAY_MS * 2);
        await assertion;
        expect(request).toHaveBeenCalledTimes(EMBEDDING_MAX_ATTEMPTS);
    });
});

describe('role-aware helpers', () => {
    it('prefixes a question for retrieval', async () => {
        respond({ embeddings: [vector] });

        await expect(embedQuery('How do I grow tomatoes?')).resolves.toEqual(vector);
        expect(fetch).toHaveBeenCalledExactlyOnceWith(
            expect.any(URL),
            expect.objectContaining({
                body: expectedBody('task: question answering | query: How do I grow tomatoes?'),
            }),
        );
    });

    it('prefixes a document', async () => {
        respond({ embeddings: [vector] });

        await expect(embedDocument('Tomatoes need warm soil.')).resolves.toEqual(vector);
        expect(fetch).toHaveBeenCalledExactlyOnceWith(
            expect.any(URL),
            expect.objectContaining({
                body: expectedBody('title: none | text: Tomatoes need warm soil.'),
            }),
        );
    });

    it('prefixes every document in a batch', async () => {
        const reversed = [...vector].reverse();
        respond({ embeddings: [vector, reversed] });

        await expect(embedDocuments(['first', 'second'])).resolves.toEqual([vector, reversed]);
        expect(fetch).toHaveBeenCalledExactlyOnceWith(
            expect.any(URL),
            expect.objectContaining({
                body: expectedBody(['title: none | text: first', 'title: none | text: second']),
            }),
        );
    });

    it.each([null, undefined, 123, {}, ['valid', 1], new Array(2)])(
        'rejects invalid document input %j without a request',
        async (texts) => {
            const request = vi.fn();
            vi.stubGlobal('fetch', request);

            await expect(embedDocuments(texts as string[])).rejects.toThrow(TypeError);
            expect(request).not.toHaveBeenCalled();
        },
    );

    it.each([null, undefined, 123, {}])('rejects invalid query input %j without a request', async (text) => {
        const request = vi.fn();
        vi.stubGlobal('fetch', request);

        await expect(embedQuery(text as string)).rejects.toThrow(TypeError);
        expect(request).not.toHaveBeenCalled();
    });

    it('returns no vectors for an empty document batch', async () => {
        const request = vi.fn();
        vi.stubGlobal('fetch', request);

        await expect(embedDocuments([])).resolves.toEqual([]);
        expect(request).not.toHaveBeenCalled();
    });
});
