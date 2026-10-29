import { z } from 'zod';

export const sourceKindSchema = z.enum(['wikipedia', 'upload', 'paste']);
export type SourceKind = z.infer<typeof sourceKindSchema>;

export const templateStatusSchema = z.enum(['active', 'retired']);
export type TemplateStatus = z.infer<typeof templateStatusSchema>;

export const actOriginSchema = z.enum(['authored', 'generated']);
export type ActOrigin = z.infer<typeof actOriginSchema>;

export const actStatusSchema = z.enum(['proposed', 'accepted', 'rejected']);
export type ActStatus = z.infer<typeof actStatusSchema>;
