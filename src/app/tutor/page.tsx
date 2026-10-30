'use client';

import { LessonFigure } from '@/components/charts/LessonFigure';
import { Page } from '@/components/client/Page';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useElapsedSeconds } from '@/hooks/useElapsedSeconds';
import { useAnswerChoice, useAnswerOpen, useCloseSession, useNextAct, useStartSession } from '@/hooks/useTutor';
import { useErrorMessage } from '@/i18n/errors';
import type { Bead } from '@/lib/lesson';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

type Turn = { turnId: string; actId: string; title: string; beads: Bead[]; retrieval?: unknown };

type Outcome = {
    verdict: 'correct' | 'wrong';
    repair: string | null;
    revealOption: number | null;
    revealAnswer: string | null;
    nextBeadIndex: number | null;
    done: boolean;
    attempts: number;
    mastery: number | null;
};

const readWhy = (retrieval: unknown) => {
    if (typeof retrieval !== 'object' || retrieval === null) {
        return null;
    }
    const entry = retrieval as { hop?: number | null; via?: string; score?: number };
    return { hop: entry.hop ?? null, via: entry.via ?? null, score: entry.score ?? null };
};

const OptionButton = ({
    text,
    state,
    disabled,
    onPick,
}: {
    text: string;
    state: 'idle' | 'picked' | 'correct';
    disabled: boolean;
    onPick: () => void;
}) => (
    <button
        className={cn(
            'w-full rounded-md border px-3 py-2 text-left text-sm transition-colors',
            state === 'idle' && 'hover:bg-accent',
            state === 'picked' && 'border-destructive bg-destructive/10',
            state === 'correct' && 'border-emerald-500 bg-emerald-500/10',
            disabled && 'cursor-not-allowed opacity-60',
        )}
        disabled={disabled}
        onClick={onPick}
        type='button'
    >
        {text}
    </button>
);

export default function TutorPage() {
    const t = useTranslations('Tutor');
    const errorMessage = useErrorMessage();
    const start = useStartSession();
    const next = useNextAct();
    const answerChoice = useAnswerChoice();
    const answerOpen = useAnswerOpen();
    const close = useCloseSession();

    const [sessionId, setSessionId] = useState<string | null>(null);
    const [turn, setTurn] = useState<Turn | null>(null);
    const [index, setIndex] = useState(0);
    const [outcome, setOutcome] = useState<Outcome | null>(null);
    const [picked, setPicked] = useState<number | null>(null);
    const [answer, setAnswer] = useState('');
    const [empty, setEmpty] = useState(false);

    const bead = turn?.beads[index] ?? null;
    const preparing = start.isPending || next.isPending;
    const preparingSeconds = useElapsedSeconds(preparing);

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
                            onSuccess: (first) => {
                                setTurn(first);
                                setIndex(0);
                                setOutcome(null);
                            },
                            onError: () => setEmpty(true),
                        },
                    );
                },
                onError: (failure) => toast.error(errorMessage(failure)),
            },
        );
    };

    const pick = (optionIndex: number) => {
        if (!sessionId || !bead || bead.kind !== 'choice') {
            return;
        }
        setPicked(optionIndex);
        answerChoice.mutate(
            { sessionId, beadIndex: index, optionIndex },
            {
                onSuccess: (result) => setOutcome(result),
                onError: (failure) => {
                    setPicked(null);
                    toast.error(errorMessage(failure));
                },
            },
        );
    };

    const submitOpen = () => {
        if (!sessionId || !bead || bead.kind !== 'open') {
            return;
        }
        answerOpen.mutate(
            { sessionId, beadIndex: index, answer },
            {
                onSuccess: (result) => {
                    setOutcome(result);
                    setAnswer('');
                },
                onError: (failure) => toast.error(errorMessage(failure)),
            },
        );
    };

    const retry = () => {
        setOutcome(null);
        setPicked(null);
    };

    const advance = () => {
        if (!sessionId) {
            return;
        }
        if (outcome?.done) {
            setOutcome(null);
            setPicked(null);
            next.mutate(
                { sessionId, query: t('nextQuery') },
                {
                    onSuccess: (followUp) => {
                        setTurn(followUp);
                        setIndex(0);
                    },
                    onError: (failure) => toast.error(errorMessage(failure)),
                },
            );
            return;
        }
        setIndex(outcome?.nextBeadIndex ?? index + 1);
        setOutcome(null);
        setPicked(null);
    };

    const end = () => {
        if (sessionId) {
            close.mutate({ sessionId });
        }
        setSessionId(null);
        setTurn(null);
        setIndex(0);
        setOutcome(null);
    };

    const why = turn ? readWhy(turn.retrieval) : null;
    const busy = answerChoice.isPending || answerOpen.isPending;

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

            {preparing ? (
                <Card className='mb-4'>
                    <CardContent className='flex items-center gap-3 py-5'>
                        <Loader2 className='size-4 animate-spin text-muted-foreground' />
                        <div>
                            <p className='text-sm font-medium'>{t('preparing')}</p>
                            <p className='text-xs text-muted-foreground'>{t('preparingHint')}</p>
                        </div>
                        <span className='ml-auto text-xs tabular-nums text-muted-foreground'>
                            {t('preparingSeconds', { seconds: preparingSeconds })}
                        </span>
                    </CardContent>
                </Card>
            ) : null}

            {sessionId === null && !preparing ? (
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

            {turn && bead && !preparing ? (
                <div className='grid gap-4 lg:grid-cols-[2fr_1fr]'>
                    <Card>
                        <CardHeader className='flex-row items-center justify-between space-y-0'>
                            <CardTitle className='text-base'>{turn.title}</CardTitle>
                            <span className='text-xs text-muted-foreground'>
                                {t('progress', { current: index + 1, total: turn.beads.length })}
                            </span>
                        </CardHeader>
                        <CardContent className='space-y-4'>
                            <p className='text-sm leading-relaxed whitespace-pre-line'>{bead.idea}</p>
                            {bead.figure === null ? null : (
                                <div className='rounded-md border p-3'>
                                    <LessonFigure figure={bead.figure} />
                                </div>
                            )}
                            <p className='text-sm font-medium leading-relaxed'>{bead.question}</p>
                            {busy ? (
                                <p className='flex items-center gap-2 text-xs text-muted-foreground'>
                                    <Loader2 className='size-3 animate-spin' />
                                    {t('checking')}
                                </p>
                            ) : null}
                            {bead.kind === 'choice' ? (
                                <div className='space-y-2'>
                                    {bead.options.map((option, optionIndex) => (
                                        <OptionButton
                                            disabled={busy || (outcome !== null && outcome.repair === null)}
                                            key={option.text}
                                            onPick={() => pick(optionIndex)}
                                            state={
                                                outcome?.revealOption === optionIndex
                                                    ? 'correct'
                                                    : picked === optionIndex && outcome !== null
                                                      ? 'picked'
                                                      : 'idle'
                                            }
                                            text={option.text}
                                        />
                                    ))}
                                </div>
                            ) : (
                                <div className='space-y-2'>
                                    <textarea
                                        className='min-h-24 w-full rounded-md border bg-background p-2 text-sm'
                                        onChange={(event) => setAnswer(event.target.value)}
                                        rows={4}
                                        value={answer}
                                    />
                                    <Button disabled={busy || answer.trim().length === 0} onClick={submitOpen}>
                                        {answerOpen.isPending ? t('submitting') : t('submit')}
                                    </Button>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    <div className='space-y-4'>
                        {outcome === null ? (
                            <p className='text-sm text-muted-foreground'>{t('pickHint')}</p>
                        ) : (
                            <Card>
                                <CardHeader>
                                    <CardTitle className='text-base'>
                                        {outcome.verdict === 'correct' ? t('correct') : t('wrong')}
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className='space-y-3 text-sm'>
                                    {outcome.repair ? <p className='leading-relaxed'>{outcome.repair}</p> : null}
                                    {outcome.revealAnswer ? (
                                        <p>
                                            <span className='text-muted-foreground'>{t('revealOpen')} </span>
                                            {outcome.revealAnswer}
                                        </p>
                                    ) : null}
                                    {outcome.revealOption === null ? null : (
                                        <p className='text-muted-foreground'>{t('revealChoice')}</p>
                                    )}
                                    {outcome.mastery === null ? null : (
                                        <p className='text-xs text-muted-foreground'>
                                            {t('mastery')}: {Math.round(outcome.mastery * 100)}%
                                        </p>
                                    )}
                                    {outcome.repair ? (
                                        <Button onClick={retry}>{t('retry')}</Button>
                                    ) : (
                                        <Button onClick={advance}>{outcome.done ? t('nextAct') : t('nextBead')}</Button>
                                    )}
                                </CardContent>
                            </Card>
                        )}

                        <details className='rounded-md border p-3 text-sm'>
                            <summary className='cursor-pointer text-muted-foreground'>{t('whyTitle')}</summary>
                            <div className='space-y-1 pt-2'>
                                <p>
                                    {t('whyGoal')}: {turn.title}
                                </p>
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
                            </div>
                        </details>
                    </div>
                </div>
            ) : null}
        </Page>
    );
}
