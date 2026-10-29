import { getDb } from './setupTestcontainer';

export const constraintEnumValues = async (table: string, column: string): Promise<string[]> => {
    const constraint = `${table}_${column}_check`;
    const result = await getDb().raw(
        `SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname = ?`,
        [constraint],
    );
    const definition: string | undefined = result.rows[0]?.definition;
    if (!definition) {
        throw new Error(`No check constraint named ${constraint}`);
    }
    return [...definition.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]).sort();
};
