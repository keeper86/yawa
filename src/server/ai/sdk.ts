import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import {
    APICallError,
    type ModelMessage,
    NoObjectGeneratedError,
    NoOutputGeneratedError,
    Output,
    embedMany,
    generateText,
} from 'ai';
import type { z } from 'zod';
import { DomainFailure } from '../domainError';
import {
    type AiConfig,
    type AiProvider,
    type ChatMessage,
    type ChatOptions,
    DEFAULT_GENERATION_TOKENS,
    MAX_EMBEDDING_BATCH,
} from './provider';
import { logger } from '../logger';
import { recordAiUsage } from './usage';

export type FetchLike = typeof fetch;

const PROVIDER_NAME = 'yawa';
const CHAT_TIMEOUT_MS = 120_000;
const EMBEDDING_TIMEOUT_MS = 120_000;
const MAX_RETRIES = 2;

const splitMessages = (messages: ChatMessage[]): { instructions: string; messages: ModelMessage[] } => ({
    instructions: messages
        .filter((message) => message.role === 'system')
        .map((message) => message.content)
        .join('\n\n'),
    messages: messages
        .filter((message) => message.role !== 'system')
        .map((message) => ({ role: message.role as 'user' | 'assistant', content: message.content })),
});

const describeError = (error: unknown): string => {
    if (APICallError.isInstance(error)) {
        return `${error.statusCode ?? 'no status'}: ${(error.responseBody ?? error.message).slice(0, 300)}`;
    }
    return error instanceof Error ? error.message : String(error);
};

const count = (value: number | undefined) => value ?? 0;

export const createAiProvider = (config: AiConfig, fetchImpl: FetchLike = fetch): AiProvider => {
    globalThis.AI_SDK_LOG_WARNINGS = (options) => logger.debug({ warnings: options.warnings }, 'ai sdk warning');

    const provider = createOpenAICompatible({
        name: PROVIDER_NAME,
        apiKey: config.chatApiKey,
        baseURL: config.chatBaseUrl,
        fetch: fetchImpl,
    });

    const embeddingProvider = createOpenAICompatible({
        name: 'yawa-embedding',
        apiKey: config.embeddingApiKey,
        baseURL: config.embeddingBaseUrl,
        fetch: fetchImpl,
    });

    const model = provider(config.chatModel);

    const attempt = async <T>(messages: ChatMessage[], schema: z.ZodType<T>, options: ChatOptions) => {
        const split = splitMessages(messages);

        const result = await generateText({
            model,
            instructions: split.instructions,
            messages: split.messages,
            maxOutputTokens: options.maxTokens ?? DEFAULT_GENERATION_TOKENS,
            temperature: options.temperature,
            maxRetries: MAX_RETRIES,
            abortSignal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
            providerOptions:
                options.effort === undefined ? undefined : { [PROVIDER_NAME]: { reasoningEffort: options.effort } },
            output: Output.object({ schema }),
            onLanguageModelCallEnd: (call) =>
                recordAiUsage({
                    label: options.label,
                    model: config.chatModel,
                    finishReason: call.finishReason,
                    inputTokens: count(call.usage.inputTokens),
                    outputTokens: count(call.usage.outputTokens),
                    reasoningTokens: count(call.usage.outputTokenDetails.reasoningTokens),
                    totalTokens: count(call.usage.totalTokens),
                    ms: Math.round(call.performance.responseTimeMs),
                }),
        });

        return result.output;
    };

    const invalidAnswer = (options: ChatOptions, error: NoObjectGeneratedError): DomainFailure => {
        if (error.finishReason === 'length') {
            return new DomainFailure(
                'aiInvalidResponse',
                `${options.label} was cut off at the token limit after ${error.text?.length ?? 0} characters; raise maxTokens`,
            );
        }
        const cause = error.cause instanceof Error ? error.cause.message : 'the answer was not valid JSON';
        return new DomainFailure(
            'aiInvalidResponse',
            `${options.label} did not produce the required JSON: ${cause} (answer started: ${(error.text ?? '').slice(0, 200)})`,
        );
    };

    return {
        embeddingModel: config.embeddingModel,
        embeddingDim: config.embeddingDim,

        chatStructured: async <T>(messages: ChatMessage[], schema: z.ZodType<T>, options: ChatOptions) => {
            let first: NoObjectGeneratedError;
            try {
                return await attempt(messages, schema, options);
            } catch (error) {
                if (NoOutputGeneratedError.isInstance(error)) {
                    throw new DomainFailure(
                        'aiInvalidResponse',
                        `${options.label} returned no output; the budget may have gone to reasoning, raise maxTokens`,
                    );
                }
                if (!NoObjectGeneratedError.isInstance(error)) {
                    throw new DomainFailure('aiUnavailable', `${options.label} failed: ${describeError(error)}`);
                }
                first = error;
            }

            if (first.finishReason === 'length') {
                throw invalidAnswer(options, first);
            }

            const cause = first.cause instanceof Error ? first.cause.message : 'the answer was not valid JSON';
            try {
                return await attempt(
                    [
                        ...messages,
                        { role: 'assistant', content: first.text ?? '' },
                        {
                            role: 'user',
                            content: `That did not match the required schema: ${cause}. Reply with the corrected JSON only.`,
                        },
                    ],
                    schema,
                    options,
                );
            } catch (error) {
                if (NoObjectGeneratedError.isInstance(error)) {
                    throw invalidAnswer(options, error);
                }
                throw new DomainFailure('aiUnavailable', `${options.label} repair failed: ${describeError(error)}`);
            }
        },

        embed: async (texts) => {
            if (texts.length === 0) {
                return [];
            }
            if (texts.length > MAX_EMBEDDING_BATCH) {
                throw new DomainFailure(
                    'aiInvalidResponse',
                    `Embedding batch of ${texts.length} exceeds the limit of ${MAX_EMBEDDING_BATCH}`,
                );
            }

            const started = Date.now();
            const result = await embedMany({
                model: embeddingProvider.embeddingModel(config.embeddingModel),
                values: texts,
                maxRetries: MAX_RETRIES,
                abortSignal: AbortSignal.timeout(EMBEDDING_TIMEOUT_MS),
            }).catch((error: unknown) => {
                throw new DomainFailure('aiUnavailable', `embedding failed: ${describeError(error)}`);
            });

            recordAiUsage({
                label: 'embed',
                model: config.embeddingModel,
                finishReason: 'stop',
                inputTokens: count(result.usage.tokens),
                outputTokens: 0,
                reasoningTokens: 0,
                totalTokens: count(result.usage.tokens),
                ms: Date.now() - started,
            });

            if (result.embeddings.length !== texts.length) {
                throw new DomainFailure(
                    'aiInvalidResponse',
                    `Expected ${texts.length} embeddings, received ${result.embeddings.length}`,
                );
            }
            for (const vector of result.embeddings) {
                if (vector.length !== config.embeddingDim) {
                    throw new DomainFailure(
                        'embeddingDimensionMismatch',
                        `Embedding has ${vector.length} dimensions, expected ${config.embeddingDim} for ${config.embeddingModel}`,
                    );
                }
            }
            return result.embeddings;
        },
    };
};
