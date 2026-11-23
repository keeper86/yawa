export const EMBEDDING_MODEL = 'embeddinggemma:300m';
export const EMBEDDING_DIMENSION = 768;
export const EMBEDDING_TIMEOUT_MS = 30_000;
export const EMBEDDING_BATCH_SIZE = 8;
export const EMBEDDING_MAX_ATTEMPTS = 3;
export const EMBEDDING_RETRY_DELAY_MS = 250;
export const EMBEDDING_KEEP_ALIVE = '30m';

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

class RetryableEmbeddingError extends EmbeddingError {}

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

const parseEmbeddings = (body: unknown, expectedVectors: number, status: number): number[][] => {
    const embeddings = typeof body === 'object' && body !== null && 'embeddings' in body ? body.embeddings : undefined;
    if (!Array.isArray(embeddings)) {
        throw new EmbeddingError('Embedding service returned an invalid vector.', status);
    }
    if (embeddings.length !== expectedVectors) {
        throw new EmbeddingError(
            `Embedding service returned ${embeddings.length} of ${expectedVectors} vectors.`,
            status,
        );
    }
    if (
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

const resolveEndpoint = (baseUrl: string): URL => {
    try {
        return new URL('/api/embed', baseUrl);
    } catch (cause) {
        throw new EmbeddingError('Embedding service URL is invalid.', undefined, cause);
    }
};

const isTimeout = (signal: AbortSignal): boolean =>
    signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError';

const toEmbeddingError = (cause: unknown, signal: AbortSignal, status: number | undefined): EmbeddingError => {
    if (isTimeout(signal)) {
        return new EmbeddingError('Embedding request timed out.', status, signal.reason);
    }
    if (cause instanceof EmbeddingError) {
        return cause;
    }
    return new RetryableEmbeddingError('Embedding request failed.', status, cause);
};

const parseJson = async (response: Response): Promise<unknown> => {
    try {
        return await response.json();
    } catch (cause) {
        throw new EmbeddingError('Embedding service returned invalid JSON.', response.status, cause);
    }
};

const requestEmbeddings = async (input: string | string[]): Promise<number[][]> => {
    const endpoint = resolveEndpoint(resolveBaseUrl());
    const expectedVectors = typeof input === 'string' ? 1 : input.length;
    const signal = AbortSignal.timeout(EMBEDDING_TIMEOUT_MS);
    let status: number | undefined;

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: EMBEDDING_MODEL,
                input,
                truncate: false,
                keep_alive: EMBEDDING_KEEP_ALIVE,
            }),
            signal,
        });
        const responseStatus = response.status;
        status = responseStatus;
        if (!response.ok) {
            const body = await response.text();
            const message = 'Embedding service rejected the request.';
            throw responseStatus === 429 || responseStatus >= 500
                ? new RetryableEmbeddingError(message, responseStatus, body)
                : new EmbeddingError(message, responseStatus, body);
        }
        return parseEmbeddings(await parseJson(response), expectedVectors, responseStatus);
    } catch (cause) {
        throw toEmbeddingError(cause, signal, status);
    }
};

const requestWithRetry = async (input: string | string[]): Promise<number[][]> => {
    for (let attempt = 1; ; attempt += 1) {
        try {
            return await requestEmbeddings(input);
        } catch (error) {
            if (!(error instanceof RetryableEmbeddingError) || attempt >= EMBEDDING_MAX_ATTEMPTS) {
                throw error;
            }
            await new Promise<void>((resolve) => {
                setTimeout(resolve, EMBEDDING_RETRY_DELAY_MS * attempt);
            });
        }
    }
};

const requestBatches = async (texts: string[]): Promise<number[][]> => {
    const vectors: number[][] = [];
    for (let start = 0; start < texts.length; start += EMBEDDING_BATCH_SIZE) {
        vectors.push(...(await requestWithRetry(texts.slice(start, start + EMBEDDING_BATCH_SIZE))));
    }
    return vectors;
};

const requestOne = async (text: string): Promise<number[]> => {
    const [vector] = await requestWithRetry(text);
    return vector;
};

const assertText = (text: unknown): void => {
    if (typeof text !== 'string') {
        throw new TypeError('Embedding input must be a string.');
    }
};

const assertTexts = (texts: unknown): void => {
    if (!Array.isArray(texts)) {
        throw new TypeError('Embedding input must be an array of strings.');
    }
    for (const text of texts) {
        assertText(text);
    }
};

export async function embedText(text: string): Promise<number[]> {
    assertText(text);
    return requestOne(text);
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
    assertTexts(texts);
    return requestBatches(texts);
}

export async function embedQuery(text: string): Promise<number[]> {
    assertText(text);
    return requestOne(`${QUERY_PREFIX}${text}`);
}

export async function embedDocument(text: string): Promise<number[]> {
    assertText(text);
    return requestOne(`${DOCUMENT_PREFIX}${text}`);
}

export async function embedDocuments(texts: string[]): Promise<number[][]> {
    assertTexts(texts);
    return requestBatches(texts.map((text) => `${DOCUMENT_PREFIX}${text}`));
}
