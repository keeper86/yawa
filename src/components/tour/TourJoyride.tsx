'use client';

import { TourTooltip } from '@/components/tour/TourTooltip';
import { useTour } from '@/components/tour/TourContext';
import { getStepsForPage } from '@/components/tour/tourSteps';
import { useIsClient } from '@/hooks/useIsClient';
import { useNavigationGuard } from '@/hooks/useNavigationGuard';
import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { EventHandler, Props } from 'react-joyride';

const Joyride = dynamic(() => import('react-joyride').then((mod) => mod.Joyride), {
    ssr: false,
}) as React.ComponentType<Props>;

function useElementPresent(selector: string | null): boolean {
    const subscribe = useCallback(
        (onStoreChange: () => void) => {
            if (!selector) {
                return () => undefined;
            }

            const observer = new MutationObserver(onStoreChange);
            observer.observe(document.body, { childList: true, subtree: true });
            return () => observer.disconnect();
        },
        [selector],
    );

    const getSnapshot = useCallback(() => (selector ? document.querySelector(selector) !== null : true), [selector]);

    return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

export function TourJoyride() {
    const pathname = usePathname();
    const { isTourActive, currentStepIndex, completeTour, setCurrentStepIndex, completedActions } = useTour();
    const t = useTranslations('Tour');
    const tGuards = useTranslations('Guards');

    const isClient = useIsClient();

    const steps = useMemo(() => getStepsForPage(t, pathname, completedActions), [t, pathname, completedActions]);

    const safeStepIndex = Math.min(currentStepIndex, Math.max(0, steps.length - 1));
    const step = steps[safeStepIndex] as { target?: unknown; data?: Record<string, unknown> } | undefined;
    const targetSelector =
        isTourActive && typeof step?.target === 'string' && step.target !== 'body' ? step.target : null;
    const timeoutMs = (step?.data?.timeoutMs as number | undefined) ?? 30000;
    const targetExists = useElementPresent(targetSelector);

    useEffect(() => {
        if (!isTourActive || !targetSelector || targetExists) {
            return;
        }

        const timeoutId = setTimeout(() => {
            const nextIndex = currentStepIndex + 1;
            if (nextIndex >= steps.length) {
                completeTour();
            } else {
                setCurrentStepIndex(nextIndex);
            }
        }, timeoutMs);

        return () => clearTimeout(timeoutId);
    }, [
        isTourActive,
        targetSelector,
        targetExists,
        timeoutMs,
        currentStepIndex,
        steps.length,
        completeTour,
        setCurrentStepIndex,
    ]);

    useNavigationGuard(isTourActive, completeTour, {
        message: tGuards('tourActive'),
        actionLabel: tGuards('endTourAndLeave'),
        infoStyle: true,
    });

    const handleOnEvent: EventHandler = (data) => {
        const { action, index, status, type } = data;
        const isBlockingStep =
            (steps[index] as { data?: Record<string, unknown> } | undefined)?.data?.blocking === true;

        if (type === 'step:after' && action === 'prev') {
            setCurrentStepIndex(Math.max(0, index - 1));
            return;
        }

        if (status === 'finished' || status === 'skipped' || action === 'close') {
            completeTour();
            return;
        }

        if (type === 'step:after' && action === 'next' && !isBlockingStep) {
            if (index === steps.length - 1) {
                completeTour();
            } else {
                setCurrentStepIndex(index + 1);
            }
        }
    };

    if (!isClient || !isTourActive || !targetExists || steps.length === 0) {
        return null;
    }

    return (
        <Joyride
            key={targetSelector ?? 'no-target'}
            steps={steps}
            run={isTourActive}
            continuous
            stepIndex={safeStepIndex}
            onEvent={handleOnEvent}
            tooltipComponent={TourTooltip}
            options={{
                spotlightPadding: 8,
                overlayClickAction: false,
                blockTargetInteraction: true,
            }}
            locale={{
                back: t('back'),
                close: t('close'),
                last: t('finish'),
                next: t('next'),
                open: t('open'),
                skip: t('skip'),
            }}
        />
    );
}
