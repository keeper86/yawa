'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useActDetail } from '@/hooks/useReviewQueue';
import { useTranslations } from 'next-intl';
import { isKnownRubricCode } from './labels';

const ReviewSidebar = ({ actId, rubric }: { actId: string; rubric: string[] }) => {
    const t = useTranslations('Lectures.review');
    const { data } = useActDetail(actId);

    return (
        <div className='space-y-4'>
            <Card>
                <CardHeader>
                    <CardTitle className='text-base'>{t('rubric')}</CardTitle>
                </CardHeader>
                <CardContent>
                    <ul className='space-y-1 text-sm'>
                        {rubric.map((code) => (
                            <li key={code}>· {isKnownRubricCode(code) ? t(`rubricCodes.${code}`) : code}</li>
                        ))}
                    </ul>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className='text-base'>{t('grounding')}</CardTitle>
                </CardHeader>
                <CardContent className='space-y-3 text-sm'>
                    {data === undefined || data.grounding.length === 0 ? (
                        <p className='text-muted-foreground'>{t('noGrounding')}</p>
                    ) : (
                        data.grounding.map((section) => (
                            <div key={section.sectionId} className='space-y-1'>
                                <p className='text-xs text-muted-foreground'>
                                    {section.sourceTitle} / {section.heading}
                                </p>
                                <p className='leading-relaxed'>{section.content}</p>
                            </div>
                        ))
                    )}
                </CardContent>
            </Card>
        </div>
    );
};

export { ReviewSidebar };
