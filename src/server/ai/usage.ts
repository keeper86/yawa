import { AsyncLocalStorage } from 'node:async_hooks';
import { z } from 'zod';
import { logger } from '../logger';

export type AiCallUsage = {
    label: string;
    model: string;
    finishReason: string;
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    totalTokens: number;
    ms: number;
};

export type AiUsageTotals = {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    totalTokens: number;
};

export const aiUsageTotalsSchema = z.object({
    calls: z.number().int().nonnegative(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    reasoningTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
});

export const emptyUsage = (): AiUsageTotals => ({
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
});

const store = new AsyncLocalStorage<AiUsageTotals>();

export const recordAiUsage = (usage: AiCallUsage) => {
    logger.info({ ...usage }, 'ai usage');

    const totals = store.getStore();
    if (totals === undefined) {
        return;
    }
    totals.calls += 1;
    totals.inputTokens += usage.inputTokens;
    totals.outputTokens += usage.outputTokens;
    totals.reasoningTokens += usage.reasoningTokens;
    totals.totalTokens += usage.totalTokens;
};

export const collectAiUsage = async <T>(run: () => Promise<T>): Promise<{ result: T; usage: AiUsageTotals }> => {
    const totals = emptyUsage();
    const result = await store.run(totals, run);
    return { result, usage: totals };
};
