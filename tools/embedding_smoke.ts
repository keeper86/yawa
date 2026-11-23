import dotenv from 'dotenv';
import { readFile } from 'node:fs/promises';
import {
    EMBEDDING_DIMENSION,
    EMBEDDING_MODEL,
    EmbeddingError,
    embedDocuments,
    embedQuery,
} from '../src/server/embedding';

dotenv.config({ override: false, quiet: true });

const ENTRYPOINT_PATH = 'docker/ollama-entrypoint.sh';
const QUERY = 'How do I keep a sourdough starter alive?';
const DOCUMENTS = [
    'Feed the starter with flour and water every day.',
    'The invoice is due on the fifteenth.',
    'Postgres stores 768-dimensional vectors in a column.',
];
const EXPECTED_TOP_DOCUMENT = DOCUMENTS[0];

function cosineDistance(left: number[], right: number[]): number {
    const denominator = Math.hypot(...left) * Math.hypot(...right);
    if (denominator === 0) throw new Error('Cannot rank a zero-length embedding vector.');
    const similarity = left.reduce((sum, value, index) => sum + value * right[index], 0) / denominator;
    return 1 - Math.max(-1, Math.min(1, similarity));
}

async function assertContainerPinsSameModel(): Promise<void> {
    const pinned = `MODEL='${EMBEDDING_MODEL}'`;
    const entrypoint = await readFile(ENTRYPOINT_PATH, 'utf8');
    if (!entrypoint.includes(pinned)) {
        throw new Error(`${ENTRYPOINT_PATH} must pin ${pinned}.`);
    }
}

function assertVector(label: string, vector: number[]): void {
    if (vector.length !== EMBEDDING_DIMENSION || !vector.every((value) => Number.isFinite(value))) {
        throw new Error(`${label} is not ${EMBEDDING_DIMENSION} finite numbers.`);
    }
}

async function main(): Promise<void> {
    const start = performance.now();
    await assertContainerPinsSameModel();
    const queryVector = await embedQuery(QUERY);
    const documentVectors = await embedDocuments(DOCUMENTS);
    assertVector('Query vector', queryVector);
    documentVectors.forEach((vector, index) => assertVector(`Document vector ${index}`, vector));

    const ranking = DOCUMENTS.map((text, index) => ({
        text,
        distance: cosineDistance(queryVector, documentVectors[index]),
    })).sort((left, right) => left.distance - right.distance);
    if (ranking[0].text !== EXPECTED_TOP_DOCUMENT) {
        throw new Error(`Expected "${EXPECTED_TOP_DOCUMENT}" to rank first, got "${ranking[0].text}".`);
    }

    console.log(
        JSON.stringify(
            {
                model: EMBEDDING_MODEL,
                dimension: queryVector.length,
                elapsedMs: performance.now() - start,
                ranking,
            },
            null,
            2,
        ),
    );
}

void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Embedding smoke test failed.');
    if (error instanceof EmbeddingError && error.status !== undefined) {
        console.error(`HTTP status: ${error.status}`);
    }
    process.exitCode = 1;
});
