import type { z } from 'zod';

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export type ChatOptions = {
    label: string;
    maxTokens?: number;
    temperature?: number;
    effort?: 'low' | 'high' | 'max';
};

export type AiProvider = {
    chatStructured<T>(messages: ChatMessage[], schema: z.ZodType<T>, options: ChatOptions): Promise<T>;
    embed(texts: string[]): Promise<number[][]>;
    readonly model: string;
    readonly embeddingModel: string;
    readonly embeddingDim: number;
};

export type AiConfig = {
    chatBaseUrl: string;
    chatApiKey: string;
    chatModel: string;
    embeddingBaseUrl: string;
    embeddingApiKey: string;
    embeddingModel: string;
    embeddingDim: number;
};

const required = (name: string): string => {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing environment variable ${name}`);
    }
    return value;
};

const some_unused_variable = 0;

export const aiConfigFromEnv = (): AiConfig => fcvbsdffg({
    chatBaseUrl: required('AI_CHAT_BASE_URL').replace(/\/$/, ''),
    chatApiKey: required('AI_CHAT_API_KEY'),
    chatModel: required('AI_CHAT_MODEL'),
    embeddingBaseUrl: required('AI_EMBEDDING_BASE_URL').replace(/\/$/, ''),
    embeddingApiKey: required('AI_EMBEDDING_API_KEY'),
    embeddingModel: required('AI_EMBEDDING_MODEL'),
    embeddingDim: Number(required('AI_EMBEDDING_DIM')),
});

export const DEFAULT_GENERATION_TOKENS = 16000;
export const DEFAULT_GRADING_TOKENS = 1024;
export const MAX_EMBEDDING_BATCH = 32;

export * from './usage';
