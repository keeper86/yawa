'use client';

import { TourTooltip } from '@/components/tour/TourTooltip';
import { useTour } from '@/components/tour/TourContext';
import { getStepsForPage } from '@/components/tour/tourSteps';
import { useNavigationGuard } from '@/hooks/useNavigationGuard';
import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { EventHandler, Props } from 'react-joyride';

const Joyride = dynamic(() => import('react-joyride').then((mod) => mod.Joyride), {
    ssr: false,
}) as React.ComponentType<Props>;

export function TourJoyride() {
    const pathname = usePathname();
    const { isTourActive, currentStepIndex, completeTour, setCurrentStepIndex, completedActions } = useTour();
    const t = useTranslations('Tour');
    const tGuards = useTranslations('Guards');

    const [mounted, setMounted] = useState(false);
    const [targetsReady, setTargetsReady] = useState(false);
    const targetSelectorRef = useRef<string | null>(null);

    useEffect(() => {
        setMounted(true);
    }, []);

    const steps = useMemo(() => getStepsForPage(t, pathname, completedActions), [t, pathname, completedActions]);

    useEffect(() => {
        setCurrentStepIndex(0);
        setTargetsReady(false);
        targetSelectorRef.current = null;
    }, [pathname, setCurrentStepIndex]);

    useEffect(() => {
        if (!isTourActive || steps.length === 0) {
            setTargetsReady(true);
            targetSelectorRef.current = null;
            return;
        }

        const step = steps[currentStepIndex];
        const target = step?.target;
        const stepData = (step as { data?: Record<string, unknown> })?.data ?? {};
        const targetSelector = target && target !== 'body' && typeof target === 'string' ? target : null;

        if (!targetSelector) {
            setTargetsReady(true);
            targetSelectorRef.current = null;
            return;
        }

        const prevTargetSelector = targetSelectorRef.current;
        targetSelectorRef.current = targetSelector;

        if (document.querySelector(targetSelector)) {
            if (prevTargetSelector && targetSelector !== prevTargetSelector) {
                setTargetsReady(false);
                requestAnimationFrame(() => setTargetsReady(true));
                return;
            }
            setTargetsReady(true);
            return;
        }

        setTargetsReady(false);

        const timeoutMs = (stepData.timeoutMs as number) ?? 30000;
        const timeoutId = setTimeout(() => {
            if (document.querySelector(targetSelector)) {
                setTargetsReady(true);
                return;
            }
            const nextIndex = currentStepIndex + 1;
            if (nextIndex >= steps.length) {
                completeTour();
            } else {
                setCurrentStepIndex(nextIndex);
            }
        }, timeoutMs);

        const observer = new MutationObserver(() => {
            if (document.querySelector(targetSelector)) {
                observer.disconnect();
                clearTimeout(timeoutId);
                setTargetsReady(true);
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });

        return () => {
            observer.disconnect();
            clearTimeout(timeoutId);
        };
    }, [isTourActive, steps, currentStepIndex, setCurrentStepIndex, completeTour]);

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

    if (!mounted || !isTourActive || !targetsReady || steps.length === 0) {
        return null;
    }

    const safeStepIndex = Math.min(currentStepIndex, steps.length - 1);

    return (
        <Joyride
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
