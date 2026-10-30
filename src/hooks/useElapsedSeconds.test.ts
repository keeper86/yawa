import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useElapsedSeconds } from './useElapsedSeconds';

describe('useElapsedSeconds', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('counts up in whole seconds while the work runs', async () => {
        vi.useFakeTimers();
        const { result } = renderHook(({ active }: { active: boolean }) => useElapsedSeconds(active), {
            initialProps: { active: true },
        });

        expect(result.current).toBe(0);

        await act(async () => {
            vi.advanceTimersByTime(2500);
        });

        expect(result.current).toBe(2);
    });

    it('resets to zero when the work ends', async () => {
        vi.useFakeTimers();
        const { result, rerender } = renderHook(({ active }: { active: boolean }) => useElapsedSeconds(active), {
            initialProps: { active: true },
        });

        await act(async () => {
            vi.advanceTimersByTime(3000);
        });
        expect(result.current).toBe(3);

        rerender({ active: false });
        expect(result.current).toBe(0);
    });
});
