import dotenv from 'dotenv';
import { EMBEDDING_MODEL, EmbeddingError, embedText } from '../src/server/embedding';

dotenv.config({ override: false, quiet: true });

async function main() {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        throw new Error('Usage: npm run embedding:debug -- "Text to embed"');
    }
    const start = performance.now();
    const vector = await embedText(args.join(' '));
    console.log(
        JSON.stringify(
            {
                model: EMBEDDING_MODEL,
                dimension: vector.length,
                norm: Math.hypot(...vector),
                elapsedMs: performance.now() - start,
                vector,
            },
            null,
            2,
        ),
    );
}

void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Embedding failed.');
    if (error instanceof EmbeddingError && error.status !== undefined) {
        console.error(`HTTP status: ${error.status}`);
    }
    process.exitCode = 1;
});
