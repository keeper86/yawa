'use client';

import { ErrorState } from '@/components/client/ErrorState';
import { LoadingState } from '@/components/client/LoadingState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useLectureActs, useReviewAct } from '@/hooks/useReviewQueue';
import { isKnownTemplate } from './labels';
import { ReviewSidebar } from './ReviewSidebar';
import { useErrorMessage } from '@/i18n/errors';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

const isTypingTarget = (target: EventTarget | null) =>
    target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);

export const ReviewQueue = ({ lectureId }: { lectureId: string }) => {
    const t = useTranslations('Lectures.review');
    const templateLabels = useTranslations('Lectures.templates');
    const errorMessage = useErrorMessage();
    const { data, isPending, isError, error } = useLectureActs(lectureId);
    const review = useReviewAct();

    const pending = useMemo(() => (data ?? []).filter((act) => act.status === 'proposed'), [data]);
    const reviewed = (data?.length ?? 0) - pending.length;
    const [cursor, setCursor] = useState(0);
    const position = pending.length === 0 ? 0 : Math.min(cursor, pending.length - 1);
    const current = pending[position];

    const decide = (decision: 'accepted' | 'rejected') => {
        if (!current) {
            return;
        }
        review.mutate(
            { actId: current.id, decision },
            {
                onSuccess: () => toast.success(decision === 'accepted' ? t('acceptedToast') : t('rejectedToast')),
                onError: (failure) => toast.error(errorMessage(failure)),
            },
        );
    };

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (isTypingTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) {
                return;
            }
            if (event.key === 'a') {
                decide('accepted');
            } else if (event.key === 'r') {
                decide('rejected');
            } else if (event.key === 'j') {
                setCursor((value) => Math.min(value + 1, Math.max(0, pending.length - 1)));
            } else if (event.key === 'k') {
                setCursor((value) => Math.max(0, value - 1));
            }
        };

        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    });

    if (isPending) {
        return <LoadingState />;
    }
    if (isError) {
        return <ErrorState description={errorMessage(error)} />;
    }

    return (
        <section className='space-y-4'>
            <div className='flex flex-wrap items-center justify-between gap-2'>
                <p className='text-sm text-muted-foreground'>{t('progress', { reviewed, total: data?.length ?? 0 })}</p>
                <p className='text-xs text-muted-foreground'>{t('shortcuts')}</p>
            </div>
            {current === undefined ? (
                <div className='rounded-lg border border-dashed p-8 text-center'>
                    <p className='font-medium'>{t('empty')}</p>
                    <p className='text-sm text-muted-foreground'>{t('emptyHint')}</p>
                </div>
            ) : (
                <div className='grid gap-4 lg:grid-cols-[2fr_1fr]'>
                    <Card>
                        <CardHeader>
                            <CardTitle>{current.title}</CardTitle>
                            <div className='flex flex-wrap gap-2 pt-2'>
                                <Badge variant='secondary'>{current.conceptTitle}</Badge>
                                <Badge variant='outline'>
                                    {isKnownTemplate(current.templateKey)
                                        ? templateLabels(current.templateKey)
                                        : current.templateKey}
                                </Badge>
                            </div>
                        </CardHeader>
                        <CardContent className='space-y-3'>
                            {current.script.steps.map((step, index) => (
                                <div key={`${current.id}-${index}`} className='flex gap-3'>
                                    <Badge className='h-fit shrink-0 font-mono text-xs' variant='outline'>
                                        {step.role}
                                    </Badge>
                                    <p className='text-sm leading-relaxed'>{step.text}</p>
                                </div>
                            ))}
                            <div className='rounded-md bg-muted p-3 text-sm'>{current.script.success.criterion}</div>
                        </CardContent>
                    </Card>
                    <ReviewSidebar actId={current.id} rubric={current.rubric} />
                    <div className='flex flex-wrap gap-2'>
                        <Button disabled={review.isPending} onClick={() => decide('accepted')}>
                            {t('accept')} ({t('acceptHint')})
                        </Button>
                        <Button disabled={review.isPending} onClick={() => decide('rejected')} variant='outline'>
                            {t('reject')} ({t('rejectHint')})
                        </Button>
                        <Button onClick={() => setCursor(position + 1)} variant='ghost'>
                            {t('next')}
                        </Button>
                        <Button onClick={() => setCursor(Math.max(0, position - 1))} variant='ghost'>
                            {t('previous')}
                        </Button>
                    </div>
                </div>
            )}
        </section>
    );
};
