import { createHash } from 'node:crypto';
import type { z } from 'zod';
import { DomainFailure } from '../domainError';
import { type AiProvider, type ChatMessage, type ChatOptions } from './provider';

export type FakeProviderOptions = {
    embeddings?: Map<string, number[]>;
    chat?: (messages: ChatMessage[], options: ChatOptions) => string;
    structured?: (messages: ChatMessage[], options: ChatOptions) => unknown;
    embeddingDim?: number;
};

const hashVector = (text: string, dimensions: number): number[] => {
    const values: number[] = [];
    let block: Buffer = createHash('sha256').update(text).digest();
    while (values.length < dimensions) {
        for (const byte of block) {
            values.push(byte / 128 - 1);
            if (values.length === dimensions) {
                break;
            }
        }
        block = createHash('sha256').update(block).digest();
    }
    const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0)) || 1;
    return values.map((value) => value / norm);
};

export const createFakeProvider = (options: FakeProviderOptions = {}): AiProvider & { calls: ChatMessage[][] } => {
    const dimensions = options.embeddingDim ?? 768;
    const calls: ChatMessage[][] = [];

    return {
        calls,
        embeddingModel: 'fake-embedding',
        embeddingDim: dimensions,

        chat: async (messages, chatOptions = {}) => {
            calls.push(messages);
            if (!options.chat) {
                throw new DomainFailure('aiInvalidResponse', 'The fake provider was asked for chat without a handler');
            }
            return options.chat(messages, chatOptions);
        },

        chatStructured: async <T>(messages: ChatMessage[], schema: z.ZodType<T>, chatOptions: ChatOptions = {}) => {
            calls.push(messages);
            if (!options.structured) {
                throw new DomainFailure('aiInvalidResponse', 'The fake provider was asked for JSON without a handler');
            }
            const parsed = schema.safeParse(options.structured(messages, chatOptions));
            if (!parsed.success) {
                throw new DomainFailure(
                    'aiInvalidResponse',
                    `Fake JSON did not match the schema: ${parsed.error.message}`,
                );
            }
            return parsed.data;
        },

        embed: async (texts) => {
            calls.push(texts.map((text) => ({ role: 'user' as const, content: text })));
            return texts.map((text) => options.embeddings?.get(text) ?? hashVector(text, dimensions));
        },
    };
};
