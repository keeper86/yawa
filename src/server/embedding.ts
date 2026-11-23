export const EMBEDDING_MODEL = 'embeddinggemma:300m';
export const EMBEDDING_DIMENSION = 768;
export const EMBEDDING_TIMEOUT_MS = 120_000;
export const EMBEDDING_BATCH_SIZE = 8;

const QUERY_PREFIX = 'task: question answering | query: ';
const DOCUMENT_PREFIX = 'title: none | text: ';

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

const resolveBaseUrl = (): string => {
    const configured = process.env.OLLAMA_BASE_URL;
    if (configured) {
        return configured;
    }
    if (process.env.NODE_ENV === 'production') {
        throw new EmbeddingError('OLLAMA_BASE_URL is not configured.');
    }
    return 'http://127.0.0.1:11434';
};

const parseEmbeddings = (body: unknown, expectedVectors: number, status: number | undefined): number[][] => {
    const embeddings = typeof body === 'object' && body !== null && 'embeddings' in body ? body.embeddings : undefined;
    if (
        !Array.isArray(embeddings) ||
        embeddings.length !== expectedVectors ||
        !embeddings.every(
            (embedding: unknown) =>
                Array.isArray(embedding) &&
                embedding.length === EMBEDDING_DIMENSION &&
                embedding.every((value: unknown) => typeof value === 'number' && Number.isFinite(value)),
        )
    ) {
        throw new EmbeddingError('Embedding service returned an invalid vector.', status);
    }
    return embeddings as number[][];
};

const requestEmbeddings = async (input: string | string[]): Promise<number[][]> => {
    const baseUrl = resolveBaseUrl();
    const expectedVectors = typeof input === 'string' ? 1 : input.length;
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
                const response = await fetch(new URL('/api/embed', baseUrl), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ model: EMBEDDING_MODEL, input, truncate: false }),
                    signal: controller.signal,
                });
                status = response.status;
                if (!response.ok) {
                    const body = await response.text();
                    throw new EmbeddingError('Embedding service rejected the request.', status, body);
                }

                const body: unknown = await response.json();
                return parseEmbeddings(body, expectedVectors, status);
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
};

const assertText = (text: unknown): void => {
    if (typeof text !== 'string') {
        throw new TypeError('Embedding input must be a string.');
    }
};

export async function embedText(text: string): Promise<number[]> {
    assertText(text);
    const [vector] = await requestEmbeddings(text);
    return vector;
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
    if (!Array.isArray(texts)) {
        throw new TypeError('Embedding input must be an array of strings.');
    }
    for (const text of texts) {
        assertText(text);
    }

    const vectors: number[][] = [];
    for (let start = 0; start < texts.length; start += EMBEDDING_BATCH_SIZE) {
        vectors.push(...(await requestEmbeddings(texts.slice(start, start + EMBEDDING_BATCH_SIZE))));
    }
    return vectors;
}

export async function embedQuery(text: string): Promise<number[]> {
    assertText(text);
    return embedText(`${QUERY_PREFIX}${text}`);
}

export async function embedDocument(text: string): Promise<number[]> {
    assertText(text);
    return embedText(`${DOCUMENT_PREFIX}${text}`);
}

export async function embedDocuments(texts: string[]): Promise<number[][]> {
    if (!Array.isArray(texts)) {
        throw new TypeError('Embedding input must be an array of strings.');
    }
    for (const text of texts) {
        assertText(text);
    }
    return embedTexts(texts.map((text) => `${DOCUMENT_PREFIX}${text}`));
}
