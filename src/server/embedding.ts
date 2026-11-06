export const EMBEDDING_MODEL = 'embeddinggemma:300m';
export const EMBEDDING_DIMENSION = 768;
export const EMBEDDING_TIMEOUT_MS = 120_000;

export class EmbeddingError extends Error {
    constructor(
        message: string,
        public readonly status: number | undefined = undefined,
        public readonly cause: unknown = undefined,
    ) {
        super(message);
        this.name = 'EmbeddingError';
    }
}

export async function embedText(text: string): Promise<number[]> {
    if (typeof text !== 'string') {
        throw new TypeError('Embedding input must be a string.');
    }

    const controller = new AbortController();
    let status: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
            const cause = new DOMException('Embedding request timed out.', 'TimeoutError');
            reject(new EmbeddingError('Embedding request timed out.', status, cause));
            controller.abort(cause);
        }, EMBEDDING_TIMEOUT_MS);
    });

    try {
        return await Promise.race([
            (async () => {
                const baseUrl = process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434';
                const response = await fetch(new URL('/api/embed', baseUrl), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ model: EMBEDDING_MODEL, input: text, truncate: false }),
                    signal: controller.signal,
                });
                status = response.status;
                if (!response.ok) {
                    const body = await response.text();
                    throw new EmbeddingError('Embedding service rejected the request.', status, body);
                }

                const body: unknown = await response.json();
                const embeddings =
                    typeof body === 'object' && body !== null && 'embeddings' in body ? body.embeddings : undefined;
                if (
                    !Array.isArray(embeddings) ||
                    embeddings.length !== 1 ||
                    !Array.isArray(embeddings[0]) ||
                    embeddings[0].length !== EMBEDDING_DIMENSION ||
                    !embeddings[0].every((value: unknown) => typeof value === 'number' && Number.isFinite(value))
                ) {
                    throw new EmbeddingError('Embedding service returned an invalid vector.', status);
                }
                return embeddings[0] as number[];
            })(),
            timeout,
        ]);
    } catch (cause) {
        if (cause instanceof EmbeddingError) {
            throw cause;
        }
        throw new EmbeddingError('Embedding request failed.', status, cause);
    } finally {
        clearTimeout(timer);
    }
}
