import { type AiProvider, aiConfigFromEnv } from './provider';
import { createAiProvider } from './sdk';

export { createFakeProvider } from './fake';
export { createAiProvider } from './sdk';
export * from './provider';

let cached: AiProvider | null = null;

export const getAi = (): AiProvider => {
    if (!cached) {
        cached = createAiProvider(aiConfigFromEnv());
    }
    return cached;
};

export const resetAiForTests = () => {
    cached = null;
};
