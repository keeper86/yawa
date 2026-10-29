'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useAddSource, useRemoveSource, useSources } from '@/hooks/useLectures';
import { useErrorMessage } from '@/i18n/errors';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

export const SourcePanel = ({ lectureId, language }: { lectureId: string; language: string }) => {
    const t = useTranslations('Lectures.sources');
    const errorMessage = useErrorMessage();
    const { data } = useSources(lectureId);
    const addSource = useAddSource();
    const removeSource = useRemoveSource();

    const [title, setTitle] = useState('');
    const [text, setText] = useState('');

    const submit = () => {
        addSource.mutate(
            { lectureId, title, text, language },
            {
                onSuccess: () => {
                    setTitle('');
                    setText('');
                    toast.success(t('added'));
                },
                onError: (failure) => toast.error(errorMessage(failure)),
            },
        );
    };

    return (
        <div className='space-y-4'>
            <Card>
                <CardHeader>
                    <CardTitle className='text-base'>{t('pasteTitle')}</CardTitle>
                </CardHeader>
                <CardContent className='space-y-3'>
                    <Input onChange={(event) => setTitle(event.target.value)} placeholder={t('title')} value={title} />
                    <textarea
                        className='min-h-32 w-full rounded-md border bg-background p-2 text-sm'
                        onChange={(event) => setText(event.target.value)}
                        placeholder={t('text')}
                        rows={8}
                        value={text}
                    />
                    <Button
                        disabled={addSource.isPending || title.trim().length === 0 || text.trim().length < 20}
                        onClick={submit}
                    >
                        {t('add')}
                    </Button>
                </CardContent>
            </Card>

            {(data ?? []).length === 0 ? <p className='text-sm text-muted-foreground'>{t('empty')}</p> : null}

            <ul className='divide-y rounded-lg border'>
                {(data ?? []).map((source) => (
                    <li key={source.id} className='flex items-center justify-between gap-4 p-3 text-sm'>
                        <div>
                            <p className='font-medium'>{source.title}</p>
                            <p className='text-muted-foreground'>
                                {source.license} · {t('sections', { count: source.sectionCount })}
                            </p>
                        </div>
                        <Button
                            onClick={() =>
                                removeSource.mutate(
                                    { sourceId: source.id },
                                    { onError: (failure) => toast.error(errorMessage(failure)) },
                                )
                            }
                            size='sm'
                            variant='ghost'
                        >
                            {t('remove')}
                        </Button>
                    </li>
                ))}
            </ul>
        </div>
    );
};
