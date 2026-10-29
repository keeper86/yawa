import type { z } from 'zod';
import { DomainFailure } from '../domainError';
import { logger } from '../logger';
import {
    type AiConfig,
    type AiProvider,
    type ChatMessage,
    type ChatOptions,
    DEFAULT_GENERATION_TOKENS,
    MAX_EMBEDDING_BATCH,
} from './provider';

const RETRYABLE_STATUS = new Set([429, 500, 502, 503]);
const MAX_ATTEMPTS = 3;

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

type CompletionResponse = {
    choices?: { message?: { content?: string; reasoning_content?: string }; finish_reason?: string }[];
};

type EmbeddingResponse = { data?: { embedding: number[] }[] };

export const createOpenAiCompatibleProvider = (config: AiConfig, fetchImpl: FetchLike = fetch): AiProvider => {
    const request = async (url: string, apiKey: string, body: unknown, timeoutMs: number): Promise<unknown> => {
        let lastError: Error | null = null;

        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
            try {
                const response = await fetchImpl(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                    body: JSON.stringify(body),
                    signal: AbortSignal.timeout(timeoutMs),
                });

                if (response.ok) {
                    return await response.json();
                }

                const detail = (await response.text()).slice(0, 300);
                if (!RETRYABLE_STATUS.has(response.status)) {
                    throw new DomainFailure('aiUnavailable', `AI request failed with ${response.status}: ${detail}`);
                }
                lastError = new Error(`${response.status}: ${detail}`);
            } catch (error) {
                if (error instanceof DomainFailure) {
                    throw error;
                }
                lastError = error instanceof Error ? error : new Error(String(error));
            }

            logger.warn({ attempt, url, error: lastError.message }, 'retrying ai request');
            if (attempt < MAX_ATTEMPTS) {
                await sleep(500 * 3 ** (attempt - 1) + Math.random() * 250);
            }
        }

        throw new DomainFailure(
            'aiUnavailable',
            `AI request failed after ${MAX_ATTEMPTS} attempts: ${lastError?.message ?? 'unknown'}`,
        );
    };

    const complete = async (messages: ChatMessage[], options: ChatOptions, json: boolean): Promise<string> => {
        const payload = await request(
            `${config.chatBaseUrl}/chat/completions`,
            config.chatApiKey,
            {
                model: config.chatModel,
                messages,
                max_tokens: options.maxTokens ?? DEFAULT_GENERATION_TOKENS,
                ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
                ...(options.effort === undefined ? {} : { reasoning_effort: options.effort }),
                ...(json ? { response_format: { type: 'json_object' } } : {}),
            },
            60_000,
        );

        const parsed = payload as CompletionResponse;
        const choice = parsed.choices?.[0];
        const content = choice?.message?.content ?? '';

        logger.debug(
            {
                model: config.chatModel,
                reasoningChars: choice?.message?.reasoning_content?.length ?? 0,
                finishReason: choice?.finish_reason,
                contentChars: content.length,
            },
            'ai completion',
        );

        if (content.trim().length === 0) {
            throw new DomainFailure(
                'aiInvalidResponse',
                `AI returned no content (finish reason ${choice?.finish_reason ?? 'unknown'})`,
            );
        }
        if (choice?.finish_reason === 'length') {
            throw new DomainFailure(
                'aiInvalidResponse',
                `AI answer was cut off at the token limit after ${content.length} characters; raise maxTokens`,
            );
        }
        return content;
    };

    return {
        embeddingModel: config.embeddingModel,
        embeddingDim: config.embeddingDim,

        chat: (messages, options = {}) => complete(messages, options, false),

        chatStructured: async <T>(messages: ChatMessage[], schema: z.ZodType<T>, options: ChatOptions = {}) => {
            const parse = (content: string) => {
                try {
                    return schema.safeParse(JSON.parse(content));
                } catch {
                    return {
                        success: false as const,
                        error: { message: `response was not valid JSON: ${content.slice(0, 300)}` },
                    };
                }
            };

            const first = await complete(messages, options, true);
            const firstParse = parse(first);
            if (firstParse.success) {
                return firstParse.data;
            }

            const repaired = await complete(
                [
                    ...messages,
                    { role: 'assistant', content: first },
                    {
                        role: 'user',
                        content: `That did not match the required schema: ${firstParse.error.message}. Reply with the corrected JSON only.`,
                    },
                ],
                options,
                true,
            );
            const secondParse = parse(repaired);
            if (secondParse.success) {
                return secondParse.data;
            }
            throw new DomainFailure(
                'aiInvalidResponse',
                `AI did not produce the required JSON: ${secondParse.error.message} (answer started: ${repaired.slice(0, 200)})`,
            );
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

            const payload = (await request(
                `${config.embeddingBaseUrl}/embeddings`,
                config.embeddingApiKey,
                { model: config.embeddingModel, input: texts },
                120_000,
            )) as EmbeddingResponse;

            const vectors = (payload.data ?? []).map((entry) => entry.embedding);
            if (vectors.length !== texts.length) {
                throw new DomainFailure(
                    'aiInvalidResponse',
                    `Expected ${texts.length} embeddings, received ${vectors.length}`,
                );
            }
            for (const vector of vectors) {
                if (vector.length !== config.embeddingDim) {
                    throw new DomainFailure(
                        'embeddingDimensionMismatch',
                        `Embedding has ${vector.length} dimensions, expected ${config.embeddingDim} for ${config.embeddingModel}`,
                    );
                }
            }
            return vectors;
        },
    };
};
