'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useGenerateActs, useLatestJob, usePlanLecture } from '@/hooks/useLectures';
import { useErrorMessage } from '@/i18n/errors';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

type PlanUnit = {
    conceptSlug: string;
    templateKey: string;
    order: number;
    rationale: string;
    sourceSectionIds: string[];
};

const formatTokens = (value: number) => (value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value));

const readUnits = (plan: unknown): PlanUnit[] => {
    if (typeof plan !== 'object' || plan === null || !('units' in plan)) {
        return [];
    }
    const units = (plan as { units: unknown }).units;
    return Array.isArray(units) ? (units as PlanUnit[]) : [];
};

export const PlanPanel = ({ lectureId }: { lectureId: string }) => {
    const t = useTranslations('Lectures.plan');
    const errorMessage = useErrorMessage();
    const { data: job } = useLatestJob(lectureId);
    const planLecture = usePlanLecture();
    const generate = useGenerateActs();

    const units = readUnits(job?.plan);

    const startPlan = () =>
        planLecture.mutate({ lectureId }, { onError: (failure) => toast.error(errorMessage(failure)) });

    const startGeneration = () => {
        if (!job) {
            return;
        }
        generate.mutate(
            { jobId: job.jobId, maxUnits: null },
            {
                onSuccess: (result) => toast.success(t('result', result)),
                onError: (failure) => toast.error(errorMessage(failure)),
            },
        );
    };

    return (
        <div className='space-y-4'>
            <div className='flex flex-wrap items-center gap-2'>
                <Button disabled={planLecture.isPending} onClick={startPlan}>
                    {planLecture.isPending ? t('planning') : t('start')}
                </Button>
                <Button disabled={!job || generate.isPending} onClick={startGeneration} variant='outline'>
                    {generate.isPending ? t('generating') : t('generate')}
                </Button>
                {job ? <Badge variant='secondary'>{job.status}</Badge> : null}
                {job?.usage ? (
                    <span className='text-xs text-muted-foreground'>
                        {t('usage', {
                            calls: job.usage.calls,
                            input: formatTokens(job.usage.inputTokens),
                            output: formatTokens(job.usage.outputTokens),
                        })}
                    </span>
                ) : null}
            </div>

            {job?.error ? <p className='text-sm text-destructive'>{job.error}</p> : null}
            {units.length === 0 ? <p className='text-sm text-muted-foreground'>{t('none')}</p> : null}

            {units.length > 0 ? (
                <Card>
                    <CardHeader>
                        <CardTitle className='text-base'>{t('units')}</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <ul className='space-y-3'>
                            {units.map((unit) => (
                                <li key={`${unit.order}-${unit.conceptSlug}-${unit.templateKey}`} className='space-y-1'>
                                    <div className='flex flex-wrap items-center gap-2'>
                                        <Badge variant='outline'>{unit.order}</Badge>
                                        <span className='font-medium'>{unit.conceptSlug}</span>
                                        <Badge variant='secondary'>{unit.templateKey}</Badge>
                                    </div>
                                    <p className='text-sm text-muted-foreground'>{unit.rationale}</p>
                                </li>
                            ))}
                        </ul>
                    </CardContent>
                </Card>
            ) : null}
        </div>
    );
};
