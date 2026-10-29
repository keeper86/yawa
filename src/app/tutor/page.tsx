'use client';

import { Page } from '@/components/client/Page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useCloseSession, useNextAct, useRespondToAct, useStartSession } from '@/hooks/useTutor';
import { useErrorMessage } from '@/i18n/errors';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

type Script = { steps: { role: string; text: string }[]; success: { criterion: string } };
type Turn = { turnId: string; actId: string; title: string; script: Script; retrieval?: unknown };
type Result = { outcome: number; mastery: number | null };

const readWhy = (retrieval: unknown) => {
    if (typeof retrieval !== 'object' || retrieval === null) {
        return null;
    }
    const entry = retrieval as { hop?: number | null; via?: string; score?: number };
    return { hop: entry.hop ?? null, via: entry.via ?? null, score: entry.score ?? null };
};

export default function TutorPage() {
    const t = useTranslations('Tutor');
    const errorMessage = useErrorMessage();
    const start = useStartSession();
    const next = useNextAct();
    const respond = useRespondToAct();
    const close = useCloseSession();

    const [sessionId, setSessionId] = useState<string | null>(null);
    const [turn, setTurn] = useState<Turn | null>(null);
    const [result, setResult] = useState<Result | null>(null);
    const [answer, setAnswer] = useState('');
    const [empty, setEmpty] = useState(false);

    const begin = () => {
        start.mutate(
            { goalConceptId: null, mode: 'study', lectureId: null },
            {
                onSuccess: (session) => {
                    setSessionId(session.sessionId);
                    setEmpty(false);
                    next.mutate(
                        { sessionId: session.sessionId, query: t('startQuery') },
                        {
                            onSuccess: (first) => setTurn(first),
                            onError: () => setEmpty(true),
                        },
                    );
                },
                onError: (failure) => toast.error(errorMessage(failure)),
            },
        );
    };

    const submit = () => {
        if (!sessionId) {
            return;
        }
        respond.mutate(
            { sessionId, answer },
            {
                onSuccess: (graded) => {
                    setResult(graded);
                    setAnswer('');
                },
                onError: (failure) => toast.error(errorMessage(failure)),
            },
        );
    };

    const advance = () => {
        if (!sessionId) {
            return;
        }
        setResult(null);
        next.mutate(
            { sessionId, query: t('nextQuery') },
            {
                onSuccess: (followUp) => setTurn(followUp),
                onError: (failure) => toast.error(errorMessage(failure)),
            },
        );
    };

    const end = () => {
        if (sessionId) {
            close.mutate({ sessionId });
        }
        setSessionId(null);
        setTurn(null);
        setResult(null);
    };

    const why = turn ? readWhy(turn.retrieval) : null;

    return (
        <Page
            headerComponent={
                sessionId === null ? null : (
                    <Button onClick={end} size='sm' variant='outline'>
                        {t('close')}
                    </Button>
                )
            }
            title={t('title')}
        >
            <p className='pb-4 text-muted-foreground'>{t('subtitle')}</p>

            {sessionId === null ? (
                <Card>
                    <CardHeader>
                        <CardTitle className='text-base'>{t('start')}</CardTitle>
                    </CardHeader>
                    <CardContent className='space-y-3'>
                        <p className='text-sm text-muted-foreground'>{t('pickGoal')}</p>
                        <Button disabled={start.isPending} onClick={begin}>
                            {start.isPending ? t('starting') : t('start')}
                        </Button>
                    </CardContent>
                </Card>
            ) : null}

            {empty ? (
                <Card>
                    <CardHeader>
                        <CardTitle className='text-base'>{t('emptyTitle')}</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className='text-sm text-muted-foreground'>{t('emptyHint')}</p>
                    </CardContent>
                </Card>
            ) : null}

            {turn ? (
                <div className='grid gap-4 lg:grid-cols-[2fr_1fr]'>
                    <Card>
                        <CardHeader>
                            <CardTitle>{turn.title}</CardTitle>
                        </CardHeader>
                        <CardContent className='space-y-3'>
                            {turn.script.steps.map((step, index) => (
                                <div key={`${turn.turnId}-${index}`} className='flex gap-3'>
                                    <Badge className='h-fit shrink-0 font-mono text-xs' variant='outline'>
                                        {step.role}
                                    </Badge>
                                    <p className='text-sm leading-relaxed'>{step.text}</p>
                                </div>
                            ))}
                            <p className='rounded-md bg-muted p-3 text-sm'>{turn.script.success.criterion}</p>
                        </CardContent>
                    </Card>

                    <div className='space-y-4'>
                        <Card>
                            <CardHeader>
                                <CardTitle className='text-base'>{t('whyTitle')}</CardTitle>
                            </CardHeader>
                            <CardContent className='space-y-1 text-sm'>
                                <p>
                                    {t('whyHop')}: {why?.hop ?? '–'}
                                </p>
                                <p>
                                    {t('whyVia')}:{' '}
                                    {why?.via === 'graph'
                                        ? t('viaGraph')
                                        : why?.via === 'vector'
                                          ? t('viaVector')
                                          : t('viaLexical')}
                                </p>
                                <p>
                                    {t('whyScore')}: {why?.score === null ? '–' : why?.score.toFixed(4)}
                                </p>
                            </CardContent>
                        </Card>

                        {result === null ? (
                            <Card>
                                <CardHeader>
                                    <CardTitle className='text-base'>{t('answer')}</CardTitle>
                                </CardHeader>
                                <CardContent className='space-y-2'>
                                    <textarea
                                        className='min-h-24 w-full rounded-md border bg-background p-2 text-sm'
                                        onChange={(event) => setAnswer(event.target.value)}
                                        rows={5}
                                        value={answer}
                                    />
                                    <Button disabled={respond.isPending || answer.trim().length === 0} onClick={submit}>
                                        {respond.isPending ? t('submitting') : t('submit')}
                                    </Button>
                                </CardContent>
                            </Card>
                        ) : (
                            <Card>
                                <CardHeader>
                                    <CardTitle className='text-base'>{t('result')}</CardTitle>
                                </CardHeader>
                                <CardContent className='space-y-2 text-sm'>
                                    <p>
                                        {t('score')}: {Math.round(result.outcome * 100)}%
                                    </p>
                                    {result.mastery === null ? null : (
                                        <p>
                                            {t('mastery')}: {Math.round(result.mastery * 100)}%
                                        </p>
                                    )}
                                    <Button onClick={advance}>{t('nextAct')}</Button>
                                </CardContent>
                            </Card>
                        )}
                    </div>
                </div>
            ) : null}
        </Page>
    );
}
