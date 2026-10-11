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
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useErrorMessage } from '@/i18n/errors';
import { useTRPC } from '@/lib/trpc';
import type { PatToken } from '@/server/controller/pAccessToken';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

const isExpired = (token: PatToken): boolean => new Date(token.expiresAt) <= new Date();

export default function PatPage() {
    const trpc = useTRPC();
    const t = useTranslations('Account.pat');
    const tc = useTranslations('Common');
    const tt = useTranslations('Toasts');
    const format = useFormatter();
    const showError = useErrorMessage();

    const [newName, setNewName] = useState('');
    const [latestTokenValue, setLatestTokenValue] = useState<string | null>(null);
    const [expiryDays, setExpiryDays] = useState(1);
    const [openTokenDialog, setOpenTokenDialog] = useState(false);

    const { data, isLoading, refetch } = useQuery(trpc.listPATs.queryOptions({}));
    const tokens = data ?? [];

    const createPATMutation = useMutation(trpc.createPAT.mutationOptions());
    const revokePATMutation = useMutation(trpc.revokePAT.mutationOptions());
    const deletePATMutation = useMutation(trpc.deletePAT.mutationOptions());

    async function createToken() {
        setLatestTokenValue(null);

        try {
            const result = await createPATMutation.mutateAsync({
                name: newName || undefined,
                expiresInDays: expiryDays,
            });
            setLatestTokenValue(result.token);
            setOpenTokenDialog(true);
            setNewName('');
            void refetch();
        } catch (error) {
            showError(error);
        }
    }

    async function revokeToken(id: string) {
        if (!confirm(t('revokeConfirm'))) {
            return;
        }

        try {
            await revokePATMutation.mutateAsync({ id });
            void refetch();
        } catch (error) {
            showError(error);
        }
    }

    async function deleteToken(id: string) {
        if (!confirm(t('deleteConfirm'))) {
            return;
        }

        try {
            await deletePATMutation.mutateAsync({ id });
            void refetch();
        } catch (error) {
            showError(error);
        }
    }

    function copyToClipboard(value: string) {
        void navigator.clipboard?.writeText(value).then(() => toast.success(tt('patTokenCopied')));
    }

    return (
        <Page title={t('title')}>
            <section className='mb-6'>
                <label htmlFor='patNameInput' className='block mb-2 text-sm font-medium'>
                    {t('nameLabel')}
                </label>
                <div className='flex flex-wrap sm:flex-nowrap gap-2 items-center'>
                    <Input id='patNameInput' value={newName} onChange={(e) => setNewName(e.target.value)} />
                    <Field>
                        <Select
                            value={String(expiryDays)}
                            onValueChange={(value: string) => setExpiryDays(Number(value))}
                        >
                            <SelectTrigger className='w-40'>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value='0.0007'>{t('expiry.minute')}</SelectItem>
                                <SelectItem value='1'>{t('expiry.day')}</SelectItem>
                                <SelectItem value='7'>{t('expiry.week')}</SelectItem>
                                <SelectItem value='30'>{t('expiry.month')}</SelectItem>
                                <SelectItem value='365'>{t('expiry.year')}</SelectItem>
                            </SelectContent>
                        </Select>
                    </Field>
                    <Button onClick={() => void createToken()} disabled={createPATMutation.isPending}>
                        {createPATMutation.isPending ? t('generating') : t('generate')}
                    </Button>
                </div>

                <Dialog open={openTokenDialog} onOpenChange={setOpenTokenDialog}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>{t('dialogTitle')}</DialogTitle>
                        </DialogHeader>
                        <DialogDescription>{t('dialogDescription')}</DialogDescription>
                        <div className='mt-2'>
                            <textarea
                                value={latestTokenValue ?? ''}
                                readOnly
                                rows={3}
                                onFocus={(e) => e.currentTarget.select()}
                                aria-label={t('tokenLabel')}
                                className='font-mono w-full resize-none break-all rounded border px-3 py-2 bg-white'
                            />
                        </div>
                        <DialogFooter>
                            <div className='flex gap-2 w-full justify-end'>
                                <Button
                                    variant='outline'
                                    onClick={() => latestTokenValue !== null && copyToClipboard(latestTokenValue)}
                                >
                                    {t('copy')}
                                </Button>
                                <Button onClick={() => setOpenTokenDialog(false)}>{tc('close')}</Button>
                            </div>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </section>

            <section>
                <h2 className='text-xl font-semibold mb-3'>{t('existingTitle')}</h2>
                {isLoading ? (
                    <div>{tc('loading')}</div>
                ) : tokens.length === 0 ? (
                    <div className='text-sm text-muted-foreground'>{t('empty')}</div>
                ) : (
                    <ul className='space-y-2'>
                        {tokens.map((token) => (
                            <li key={token.id} className='flex items-center justify-between rounded border p-3'>
                                <div>
                                    <div className='flex items-center gap-2'>
                                        <div className='font-medium'>{token.name || t('unnamed')}</div>
                                        {isExpired(token) ? <Badge variant='destructive'>{t('expired')}</Badge> : null}
                                    </div>
                                    <div className='text-xs text-muted-foreground'>
                                        {t('created', {
                                            date: format.dateTime(new Date(token.createdAt), 'timestamp'),
                                        })}
                                        {' · '}
                                        {t('expires', {
                                            date: format.dateTime(new Date(token.expiresAt), 'timestamp'),
                                        })}
                                    </div>
                                </div>
                                <div className='flex items-center gap-2'>
                                    <Button
                                        variant={isExpired(token) ? 'ghost' : 'outline'}
                                        disabled={isExpired(token) || revokePATMutation.isPending}
                                        title={isExpired(token) ? t('alreadyRevoked') : t('revokeTitle')}
                                        onClick={() => void revokeToken(token.id)}
                                    >
                                        {t('revoke')}
                                    </Button>
                                    <Button
                                        variant='destructive'
                                        disabled={deletePATMutation.isPending}
                                        onClick={() => void deleteToken(token.id)}
                                    >
                                        {t('delete')}
                                    </Button>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </section>
        </Page>
    );
}
