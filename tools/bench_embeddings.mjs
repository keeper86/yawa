import { readFileSync } from 'node:fs';

const readEnvFile = () => {
    try {
        return Object.fromEntries(
            readFileSync(new URL('../.env', import.meta.url), 'utf8')
                .split('\n')
                .filter((line) => line.includes('=') && !line.trimStart().startsWith('#'))
                .map((line) => {
                    const index = line.indexOf('=');
                    return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
                }),
        );
    } catch {
        return {};
    }
};

const env = readEnvFile();
const pick = (key) => process.env[key] ?? env[key];
const baseUrl = pick('AI_EMBEDDING_BASE_URL').replace(/\/$/, '');
const model = pick('AI_EMBEDDING_MODEL');
const apiKey = pick('AI_EMBEDDING_API_KEY');
const expectedDim = Number(pick('AI_EMBEDDING_DIM'));
const sectionCount = Number(process.env.BENCH_SECTIONS ?? 100);
const sentenceCount = Number(process.env.BENCH_SENTENCES ?? 12);
const batchSizes = (process.env.BENCH_BATCHES ?? '8,16,32').split(',').map(Number);

const sentences = [
    'Die Trapezregel naehert das Integral durch die Flaeche eines Trapezes an.',
    'Der Fehler der Trapezregel faellt quadratisch mit der Schrittweite.',
    'Die Simpsonregel interpoliert die Stuetzstellen durch eine Parabel.',
    'Ohne Interpolation gibt es keine Stuetzstelle zwischen den Grenzen.',
    'Die Summenformel von Euler und Maclaurin erklaert die Fehlerordnung.',
    'Der Fehler der Simpsonregel verschwindet fuer Polynome dritten Grades.',
    'Eine Verdopplung der Intervalle halbiert die Schrittweite.',
    'Die Steigung der Tangente ist der Wert der Ableitung.',
    'Der Hauptsatz verbindet Differentiation und Integration.',
    'Die Riemannsumme ist der Grenzfall einer Zerlegung.',
    'Die Genauigkeit haengt von der Kruemmung des Integranden ab.',
    'Ein Sprung im Integranden zerstoert die Fehlerordnung.',
];

const makeSection = (index) =>
    Array.from({ length: sentenceCount }, (_, n) => `${sentences[(index + n) % sentences.length]} Absatz ${index}, Satz ${n}.`).join(
        ' ',
    );

const embedBatch = async (texts) => {
    const started = performance.now();
    const response = await fetch(`${baseUrl}/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, input: texts }),
    });
    if (!response.ok) {
        throw new Error(`${response.status} ${await response.text()}`);
    }
    const payload = await response.json();
    const latency = performance.now() - started;
    const vectors = payload.data.map((entry) => entry.embedding);
    for (const vector of vectors) {
        if (vector.length !== expectedDim) {
            throw new Error(`dimension ${vector.length} does not match AI_EMBEDDING_DIM ${expectedDim}`);
        }
    }
    return { vectors, latency };
};

const percentile = (values, fraction) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))];
};

const sections = Array.from({ length: sectionCount }, (_, index) => makeSection(index));

const warmup = await embedBatch([sections[0]]);
const norm = Math.sqrt(warmup.vectors[0].reduce((sum, value) => sum + value * value, 0));

console.log(`model=${model} dim=${warmup.vectors[0].length} l2-norm=${norm.toFixed(6)}`);
console.log(`sections=${sectionCount} sentences=${sentenceCount} chars=${sections[0].length}`);
console.log('batch | requests | sections/s | p50 ms | p95 ms | total s');

for (const batchSize of batchSizes) {
    const batches = [];
    for (let index = 0; index < sections.length; index += batchSize) {
        batches.push(sections.slice(index, index + batchSize));
    }
    await embedBatch(batches[0]);
    const started = performance.now();
    const latencies = [];
    for (const batch of batches) {
        const result = await embedBatch(batch);
        latencies.push(result.latency);
    }
    const total = (performance.now() - started) / 1000;
    const throughput = (sections.length / total).toFixed(2);
    console.log(
        `${String(batchSize).padStart(5)} | ${String(batches.length).padStart(8)} | ${throughput.padStart(10)} | ${percentile(
            latencies,
            0.5,
        ).toFixed(0).padStart(6)} | ${percentile(latencies, 0.95).toFixed(0).padStart(6)} | ${total.toFixed(2).padStart(7)}`,
    );
}
