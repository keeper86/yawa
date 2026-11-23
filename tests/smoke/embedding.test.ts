import { expect, it } from 'vitest';
import { EMBEDDING_DIMENSION, embedDocuments, embedQuery } from '@/server/embedding';

const cosineSimilarity = (left: number[], right: number[]): number => {
    const denominator = Math.hypot(...left) * Math.hypot(...right);
    if (denominator === 0) {
        throw new Error('Cannot compare a zero-length embedding vector.');
    }
    return left.reduce((sum, value, index) => sum + value * right[index], 0) / denominator;
};

it('ranks related text closer than unrelated text on the real service', async () => {
    const queryVector = await embedQuery('How do I grow tomatoes?');
    const [relatedVector, unrelatedVector] = await embedDocuments([
        'Tomatoes need warm soil and regular watering.',
        'A spacecraft measures radiation near the rings of Saturn.',
    ]);

    for (const vector of [queryVector, relatedVector, unrelatedVector]) {
        expect(vector).toHaveLength(EMBEDDING_DIMENSION);
        expect(vector.every((value) => typeof value === 'number' && Number.isFinite(value))).toBe(true);
        expect(Math.hypot(...vector)).toBeGreaterThan(0);
        expect(vector.some((value) => Math.abs(value - vector[0]) > 1e-8)).toBe(true);
    }
    expect(queryVector.some((value, index) => Math.abs(value - unrelatedVector[index]) > 1e-6)).toBe(true);
    expect(cosineSimilarity(queryVector, relatedVector)).toBeGreaterThan(
        cosineSimilarity(queryVector, unrelatedVector),
    );
});
