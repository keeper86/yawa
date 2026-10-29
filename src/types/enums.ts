import { z } from 'zod';

export const sourceKindSchema = z.enum(['wikipedia', 'upload', 'paste']);
export type SourceKind = z.infer<typeof sourceKindSchema>;
