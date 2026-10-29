import { z } from 'zod';

export const sourceKindSchema = z.enum(['wikipedia', 'upload', 'paste']);
export type SourceKind = z.infer<typeof sourceKindSchema>;

export const templateStatusSchema = z.enum(['active', 'retired']);
export type TemplateStatus = z.infer<typeof templateStatusSchema>;

export const actOriginSchema = z.enum(['authored', 'generated']);
export type ActOrigin = z.infer<typeof actOriginSchema>;

export const actStatusSchema = z.enum(['proposed', 'accepted', 'rejected']);
export type ActStatus = z.infer<typeof actStatusSchema>;

export const relationTypeSchema = z.enum(['requires', 'contrasts_with']);
export type RelationType = z.infer<typeof relationTypeSchema>;

export const relationStatusSchema = z.enum(['suggested', 'published', 'rejected']);
export type RelationStatus = z.infer<typeof relationStatusSchema>;

export const sessionModeSchema = z.enum(['study', 'rehearsal']);
export type SessionMode = z.infer<typeof sessionModeSchema>;

export const turnRoleSchema = z.enum(['agent', 'learner']);
export type TurnRole = z.infer<typeof turnRoleSchema>;

export const evidenceKindSchema = z.enum(['answer', 'self_report', 'act_completed', 'act_abandoned']);
export type EvidenceKind = z.infer<typeof evidenceKindSchema>;
