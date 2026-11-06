import { expect, it } from 'vitest';
import { EMBEDDING_DIMENSION, embedText } from '@/server/embedding';

it('embeds two unrelated texts into distinct, usable vectors on the real service', async () => {
    const first = await embedText('A gardener plants tomatoes in the warm spring soil.');
    const second = await embedText('A spacecraft measures radiation near the rings of Saturn.');

    for (const vector of [first, second]) {
        expect(vector).toHaveLength(EMBEDDING_DIMENSION);
        expect(vector.every((value) => typeof value === 'number' && Number.isFinite(value))).toBe(true);
        expect(Math.hypot(...vector)).toBeGreaterThan(0);
        expect(vector.some((value) => Math.abs(value - vector[0]) > 1e-8)).toBe(true);
    }
    expect(first.some((value, index) => Math.abs(value - second[index]) > 1e-6)).toBe(true);
});
