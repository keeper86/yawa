import dotenv from 'dotenv';
import { readFile } from 'node:fs/promises';
import { EMBEDDING_MODEL, EmbeddingError, embedText } from '../src/server/embedding';

dotenv.config({ override: false, quiet: true });

const usage = `Usage:
  npm run embedding:debug -- "Text to embed"
  npm run embedding:debug -- --query "Search query" "First text" "Second text" ...
  npm run embedding:debug -- --query "Search query" --file texts.json

--file accepts a JSON array of strings. Files and text arguments can be combined.
Results are ranked by cosine distance (lower is closer). Use -- before texts that start with --.`;

async function parseArgs(args: string[]) {
    let query: string | undefined;
    const texts: string[] = [];
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--') {
            texts.push(...args.slice(i + 1));
            break;
        }
        if (arg === '--query' || arg === '--file') {
            const value = args[++i];
            if (value === undefined || value.startsWith('--')) {
                throw new Error(`Missing value for ${arg}.\n${usage}`);
            }
            if (arg === '--query') {
                if (query !== undefined) throw new Error('Provide --query only once.');
                query = value;
            } else {
                const input: unknown = JSON.parse(await readFile(value, 'utf8'));
                if (!Array.isArray(input) || !input.every((text: unknown) => typeof text === 'string')) {
                    throw new Error(`${value} must contain a JSON array of strings.`);
                }
                texts.push(...input);
            }
        } else if (arg.startsWith('--')) {
            throw new Error(`Unknown option: ${arg}.\n${usage}`);
        } else {
            texts.push(arg);
        }
    }
    if (texts.length === 0) throw new Error(`Provide at least one text.\n${usage}`);
    return { query, texts };
}

function cosineDistance(left: number[], right: number[]) {
    const denominator = Math.hypot(...left) * Math.hypot(...right);
    if (denominator === 0) throw new Error('Cannot rank a zero-length embedding vector.');
    const similarity = left.reduce((sum, value, index) => sum + value * right[index], 0) / denominator;
    return 1 - Math.max(-1, Math.min(1, similarity));
}

async function main() {
    const args = process.argv.slice(2);
    if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
        console.log(usage);
        return;
    }
    const { query, texts } = await parseArgs(args);
    const start = performance.now();
    if (query !== undefined) {
        const queryVector = await embedText(query);
        const results = [];
        // Embed sequentially to avoid flooding the local CPU service with requests.
        for (const [index, text] of texts.entries()) {
            const vector = await embedText(text);
            results.push({ index: index + 1, text, cosineDistance: cosineDistance(queryVector, vector) });
        }
        results.sort((a, b) => a.cosineDistance - b.cosineDistance || a.index - b.index);
        console.log(
            JSON.stringify(
                {
                    model: EMBEDDING_MODEL,
                    dimension: queryVector.length,
                    query,
                    elapsedMs: performance.now() - start,
                    results: results.map((result, index) => ({ rank: index + 1, ...result })),
                },
                null,
                2,
            ),
        );
        return;
    }
    const vector = await embedText(texts.join(' '));
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
