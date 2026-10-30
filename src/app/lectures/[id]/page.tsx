'use client';

import { ErrorState } from '@/components/client/ErrorState';
import { LoadingState } from '@/components/client/LoadingState';
import { Page } from '@/components/client/Page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useLecture, usePublishLecture } from '@/hooks/useLectures';
import { useErrorMessage } from '@/i18n/errors';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { toast } from 'sonner';
import { PlanPanel } from '../_components/PlanPanel';
import { ReviewQueue } from '../_components/ReviewQueue';
import { SourcePanel } from '../_components/SourcePanel';

export default function LectureDetailPage() {
    const params = useParams<'/lectures/[id]'>();
    const t = useTranslations('Lectures');
    const errorMessage = useErrorMessage();
    const { data, isPending, isError, error } = useLecture(params.id);
    const publish = usePublishLecture();

    const onPublish = () => {
        if (!data) {
            return;
        }
        publish.mutate(
            { lectureId: data.lecture.id },
            {
                onSuccess: () => toast.success(t('publishedToast')),
                onError: (failure) => toast.error(errorMessage(failure)),
            },
        );
    };

    if (isPending) {
        return (
            <Page title={t('title')}>
                <LoadingState />
            </Page>
        );
    }
    if (isError || !data) {
        return (
            <Page title={t('title')}>
                <ErrorState description={errorMessage(error)} />
            </Page>
        );
    }

    return (
        <Page
            headerComponent={
                <>
                    <Badge variant={data.lecture.publishedAt === null ? 'secondary' : 'default'}>
                        {data.lecture.publishedAt === null ? t('draft') : t('published')}
                    </Badge>
                    <Button disabled={publish.isPending} onClick={onPublish} size='sm'>
                        {t('publish')}
                    </Button>
                </>
            }
            title={data.lecture.title}
        >
            <Tabs defaultValue='review'>
                <TabsList>
                    <TabsTrigger value='review'>{t('tabs.review')}</TabsTrigger>
                    <TabsTrigger value='plan'>{t('tabs.plan')}</TabsTrigger>
                    <TabsTrigger value='sources'>{t('tabs.sources')}</TabsTrigger>
                </TabsList>
                <TabsContent className='pt-4' value='review'>
                    <ReviewQueue lectureId={data.lecture.id} />
                </TabsContent>
                <TabsContent className='pt-4' value='plan'>
                    <PlanPanel lectureId={data.lecture.id} />
                </TabsContent>
                <TabsContent className='pt-4' value='sources'>
                    <SourcePanel language={data.lecture.language} lectureId={data.lecture.id} />
                </TabsContent>
            </Tabs>
        </Page>
    );
}
