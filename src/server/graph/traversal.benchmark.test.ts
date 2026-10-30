import { getDb } from 'tests/vitest/setupTestcontainer';
import { describe, expect, it } from 'vitest';
import { prerequisiteClosure } from './traversal';

const scale = Number(process.env.GRAPH_BENCH_SCALE ?? 0);
const RUNS = 100;
const P95_BUDGET_MS = 20;

const percentile = (values: number[], fraction: number) => {
    const sorted = [...values].sort((left, right) => left - right);
    return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))];
};

const seed = async (edges: number) => {
    const db = getDb();
    const concepts = Math.max(50, Math.floor(edges / 20));

    await db.raw(
        `INSERT INTO concepts (slug, title, language)
         SELECT 'bench-' || i, 'Benchmark ' || i, 'de' FROM generate_series(1, ?) AS i`,
        [concepts],
    );

    await db.raw(
        `WITH ids AS (SELECT array_agg(id) AS arr FROM concepts WHERE slug LIKE 'bench-%')
         INSERT INTO concept_relations (source_concept_id, target_concept_id, type, status)
         SELECT arr[1 + (i % ?)], arr[1 + ((i * 7 + 13) % ?)], 'requires', 'published'
         FROM ids, generate_series(1, ?) AS i
         WHERE arr[1 + (i % ?)] <> arr[1 + ((i * 7 + 13) % ?)]
         ON CONFLICT DO NOTHING`,
        [concepts, concepts, edges, concepts, concepts],
    );

    return concepts;
};

describe.skipIf(scale === 0)('prerequisiteClosure benchmark', () => {
    it(`keeps depth 2 under ${P95_BUDGET_MS} ms at ${scale} edges`, async () => {
        const db = getDb();
        const concepts = await seed(scale);

        const ids: string[] = await db('concepts')
            .whereIn(
                'slug',
                Array.from({ length: RUNS }, (_, index) => `bench-${index + 1}`),
            )
            .pluck('id');

        await prerequisiteClosure(db, [ids[0]], { depth: 2, statuses: ['published'] });

        const durations: number[] = [];
        for (const id of ids) {
            const started = performance.now();
            await prerequisiteClosure(db, [id], { depth: 2, statuses: ['published'] });
            durations.push(performance.now() - started);
        }

        const p95 = percentile(durations, 0.95);
        console.log(
            `edges=${scale} concepts=${concepts} runs=${RUNS} p50=${percentile(durations, 0.5).toFixed(2)}ms p95=${p95.toFixed(2)}ms`,
        );

        expect(p95).toBeLessThan(P95_BUDGET_MS);
    });

    it('uses the source index of the relation table', async () => {
        const plan = await getDb().raw(
            `EXPLAIN SELECT r.target_concept_id FROM concept_relations r WHERE r.source_concept_id = (SELECT id FROM concepts LIMIT 1)`,
        );
        const text = (plan.rows as { 'QUERY PLAN': string }[]).map((row) => row['QUERY PLAN']).join('\n');

        expect(text).toContain('idx_relations_source');
    });
});
