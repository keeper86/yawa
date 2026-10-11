import { authOptions } from '@/app/api/auth/[...nextauth]/authOptions';
import { LoginCard } from '@/components/client/LoginCard';
import { Page } from '@/components/client/Page';
import { getTranslations } from 'next-intl/server';
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';

export default async function LandingPage() {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
        const t = await getTranslations('Login');
        return (
            <Page title={t('pageTitle')}>
                <LoginCard />
            </Page>
        );
    }

    redirect('/account');
}
