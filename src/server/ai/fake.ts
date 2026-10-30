import { createHash } from 'node:crypto';
import type { z } from 'zod';
import { DomainFailure } from '../domainError';
import { type AiProvider, type ChatMessage, type ChatOptions } from './provider';
import { recordAiUsage } from './usage';

export type FakeProviderOptions = {
    embeddings?: Map<string, number[]>;
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
        model: 'fake-chat',
        embeddingModel: 'fake-embedding',
        embeddingDim: dimensions,

        chatStructured: async <T>(messages: ChatMessage[], schema: z.ZodType<T>, chatOptions: ChatOptions) => {
            calls.push(messages);
            recordAiUsage({
                label: chatOptions.label,
                model: 'fake-chat',
                finishReason: 'stop',
                inputTokens: 1,
                outputTokens: 1,
                reasoningTokens: 0,
                totalTokens: 2,
                ms: 0,
            });
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
