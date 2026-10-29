import { createOpenAiCompatibleProvider } from './openAiCompatible';
import { type AiProvider, aiConfigFromEnv } from './provider';

export { createFakeProvider } from './fake';
export { createOpenAiCompatibleProvider } from './openAiCompatible';
export * from './provider';

let cached: AiProvider | null = null;

export const getAi = (): AiProvider => {
    if (!cached) {
        cached = createOpenAiCompatibleProvider(aiConfigFromEnv());
    }
    return cached;
};

export const resetAiForTests = () => {
    cached = null;
};
