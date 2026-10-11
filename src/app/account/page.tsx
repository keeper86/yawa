'use client';
import { AvatarUploadDialog } from '@/app/account/AvatarUploadDialog';
import { Page } from '@/components/client/Page';
import { useTour } from '@/components/tour/TourContext';
import { Button } from '@/components/ui/button';
import { APP_ROUTES } from '@/lib/appRoutes';
import { KeyRound } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useSession } from 'next-auth/react';

export default function AccountPage() {
    const session = useSession();
    const { resetTour } = useTour();
    const t = useTranslations('Account');
    const tc = useTranslations('Common');

    if (session.status !== 'authenticated') {
        return <div>{tc('loading')}</div>;
    }

    return (
        <Page title={t('title')}>
            <div className='w-full max-w-md space-y-4 flex flex-col flex-gap-2'>
                <AvatarUploadDialog />

                <Button asChild variant='outline' className='w-full justify-start'>
                    <Link href={APP_ROUTES.account.pat.path}>
                        <KeyRound />
                        {t('pat.manage')}
                    </Link>
                </Button>

                <Button
                    type='button'
                    className='inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors'
                    onClick={() => resetTour()}
                >
                    {t('restartTour')}
                </Button>
            </div>
        </Page>
    );
}
