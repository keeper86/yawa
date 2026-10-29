'use client';

import { Page } from '@/components/client/Page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ErrorState } from '@/components/client/ErrorState';
import { LoadingState } from '@/components/client/LoadingState';
import { useCreateLecture, useLectures } from '@/hooks/useLectures';
import { useErrorMessage } from '@/i18n/errors';
import { useFormatter, useTranslations } from 'next-intl';
import Link from 'next/link';
import { route } from 'nextjs-routes';
import { useState } from 'react';
import { toast } from 'sonner';

export default function LecturesPage() {
    const t = useTranslations('Lectures');
    const format = useFormatter();
    const errorMessage = useErrorMessage();
    const { data, isPending, isError, error } = useLectures();
    const createLecture = useCreateLecture();

    const [open, setOpen] = useState(false);
    const [title, setTitle] = useState('');
    const [language, setLanguage] = useState('de');

    const submit = () => {
        createLecture.mutate(
            { title, language },
            {
                onSuccess: () => {
                    setOpen(false);
                    setTitle('');
                },
                onError: (failure) => toast.error(errorMessage(failure)),
            },
        );
    };

    return (
        <Page title={t('title')}>
            <p className='pb-4 text-muted-foreground'>{t('subtitle')}</p>
            <div className='mb-4 flex justify-end'>
                <Button onClick={() => setOpen(true)}>{t('create')}</Button>
            </div>

            {isPending ? <LoadingState /> : null}
            {isError ? <ErrorState description={errorMessage(error)} /> : null}

            {data && data.length === 0 ? (
                <div className='rounded-lg border border-dashed p-8 text-center'>
                    <p className='font-medium'>{t('empty')}</p>
                    <p className='text-sm text-muted-foreground'>{t('emptyHint')}</p>
                </div>
            ) : null}

            <ul className='divide-y rounded-lg border'>
                {(data ?? []).map((lecture) => (
                    <li key={lecture.id} className='flex items-center justify-between gap-4 p-4'>
                        <div>
                            <Link
                                className='font-medium hover:underline'
                                href={route({ pathname: '/lectures/[id]', query: { id: lecture.id } })}
                            >
                                {lecture.title}
                            </Link>
                            <p className='text-sm text-muted-foreground'>
                                {format.dateTime(new Date(lecture.updatedAt), { dateStyle: 'medium' })}
                            </p>
                        </div>
                        <div className='flex items-center gap-2'>
                            {lecture.briefValid ? null : <Badge variant='outline'>{t('briefIncomplete')}</Badge>}
                            <Badge variant={lecture.publishedAt === null ? 'secondary' : 'default'}>
                                {lecture.publishedAt === null ? t('draft') : t('published')}
                            </Badge>
                            <Button asChild size='sm' variant='outline'>
                                <Link href={route({ pathname: '/lectures/[id]', query: { id: lecture.id } })}>
                                    {t('open')}
                                </Link>
                            </Button>
                        </div>
                    </li>
                ))}
            </ul>

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t('createTitle')}</DialogTitle>
                        <DialogDescription>{t('createDescription')}</DialogDescription>
                    </DialogHeader>
                    <div className='space-y-3'>
                        <div className='space-y-1'>
                            <Label htmlFor='lecture-title'>{t('name')}</Label>
                            <Input
                                id='lecture-title'
                                value={title}
                                onChange={(event) => setTitle(event.target.value)}
                            />
                        </div>
                        <div className='space-y-1'>
                            <Label htmlFor='lecture-language'>{t('language')}</Label>
                            <Input
                                id='lecture-language'
                                value={language}
                                onChange={(event) => setLanguage(event.target.value)}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button disabled={title.trim().length === 0 || createLecture.isPending} onClick={submit}>
                            {t('create')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Page>
    );
}
