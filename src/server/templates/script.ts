import { z } from 'zod';

export const scriptStepSchema = z.object({
    role: z.string().min(1),
    text: z.string().min(1).max(1200),
});

export const baseScriptSchema = z.object({
    steps: z.array(scriptStepSchema).min(3).max(8),
    success: z.object({ criterion: z.string().min(1).max(400) }),
});

export type Script = z.infer<typeof baseScriptSchema>;

export const scriptSchemaWithRoles = (roles: readonly string[]) =>
    baseScriptSchema.extend({
        steps: z
            .array(
                z.object({
                    role: z.enum(roles as [string, ...string[]]),
                    text: z.string().min(1).max(1200),
                }),
            )
            .min(3)
            .max(8),
    });
