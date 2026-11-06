import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMBEDDING_MODEL, EMBEDDING_TIMEOUT_MS, EmbeddingError, embedText } from './embedding';

const vector = Array.from({ length: 768 }, (_, index) => index / 768);

function respond(body: unknown, status = 200) {
    return vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })));
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
                body: JSON.stringify({ model: EMBEDDING_MODEL, input: text, truncate: false }),
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

    it.each([null, undefined, 123, {}, ['text']])('rejects non-string input %j without a request', async (text) => {
        const request = vi.fn();
        vi.stubGlobal('fetch', request);
        await expect(embedText(text as string)).rejects.toThrow(TypeError);
        expect(request).not.toHaveBeenCalled();
    });

    it('preserves transport failures as the cause', async () => {
        const cause = new TypeError('Connection refused');
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(cause));
        await expect(embedText('text')).rejects.toMatchObject({ name: 'EmbeddingError', cause, status: undefined });
    });

    it.each([400, 404, 500, 503])(
        'preserves HTTP status %i and the error body without exposing it in the message',
        async (status) => {
            const body = { error: 'service detail' };
            respond(body, status);
            await expect(embedText('private text')).rejects.toMatchObject({
                name: 'EmbeddingError',
                message: 'Embedding service rejected the request.',
                status,
                cause: JSON.stringify(body),
            });
        },
    );

    it('preserves invalid JSON errors and the successful HTTP status', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('invalid json')));
        await expect(embedText('text')).rejects.toMatchObject({
            name: 'EmbeddingError',
            status: 200,
            cause: expect.any(SyntaxError),
        });
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
