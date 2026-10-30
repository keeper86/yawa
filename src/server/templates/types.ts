import type { z } from 'zod';
import type { Script } from './script';

export type TemplateKey =
    'worked-example' | 'self-explanation' | 'contrasting-cases' | 'predict-observe-explain' | 'retrieval-practice';

export type TemplateDefinition = {
    key: TemplateKey;
    version: number;
    name: string;
    promptFragment: string;
    roles: readonly string[];
    scriptSchema: z.ZodType<Script>;
};
