import dotenv from 'dotenv';
import { readFile } from 'node:fs/promises';
import {
    EMBEDDING_MODEL,
    EmbeddingError,
    embedDocuments,
    embedQuery,
    embedText,
    embedTexts,
} from '../src/server/embedding';

dotenv.config({ override: false, quiet: true });

const usage = `Usage:
  npm run embedding:debug -- "Text to embed"
  npm run embedding:debug -- --query "Search query" "First text" "Second text" ...
  npm run embedding:debug -- --query "Search query" --file texts.json
  npm run embedding:debug -- --raw "Text to embed"

--file accepts a JSON array of strings. Files and text arguments can be combined.
Queries and documents use the EmbeddingGemma task prompts; --raw sends the text unchanged.
Rankings use cosine distance (lower is closer). Use -- before texts that start with --.`;

const prefix = (raw: boolean) => (raw ? 'none' : 'embeddinggemma-task');

async function parseArgs(args: string[]) {
    let query: string | undefined;
    let raw = false;
    const texts: string[] = [];
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--') {
            texts.push(...args.slice(i + 1));
            break;
        }
        if (arg === '--raw') {
            raw = true;
        } else if (arg === '--query' || arg === '--file') {
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
    return { query, raw, texts };
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
    const { query, raw, texts } = await parseArgs(args);
    const embedQueryText = raw ? embedText : embedQuery;
    const embedDocumentTexts = raw ? embedTexts : embedDocuments;
    const start = performance.now();
    if (query !== undefined) {
        const queryVector = await embedQueryText(query);
        const vectors = await embedDocumentTexts(texts);
        const results = texts.map((text, index) => ({
            index: index + 1,
            text,
            cosineDistance: cosineDistance(queryVector, vectors[index]),
        }));
        results.sort((a, b) => a.cosineDistance - b.cosineDistance || a.index - b.index);
        console.log(
            JSON.stringify(
                {
                    model: EMBEDDING_MODEL,
                    prompts: prefix(raw),
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
    const vectors = await embedDocumentTexts(texts);
    console.log(
        JSON.stringify(
            {
                model: EMBEDDING_MODEL,
                prompts: prefix(raw),
                elapsedMs: performance.now() - start,
                texts: texts.map((text, index) => ({
                    text,
                    dimension: vectors[index].length,
                    norm: Math.hypot(...vectors[index]),
                    vector: vectors[index],
                })),
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
