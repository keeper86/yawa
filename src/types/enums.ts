import { z } from 'zod';

export const sourceKindSchema = z.enum(['wikipedia', 'upload', 'paste']);
export type SourceKind = z.infer<typeof sourceKindSchema>;

export const templateStatusSchema = z.enum(['active', 'retired']);
export type TemplateStatus = z.infer<typeof templateStatusSchema>;
