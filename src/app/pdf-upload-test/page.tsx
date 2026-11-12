import { Page } from '@/components/client/Page';
import { getTranslations } from 'next-intl/server';

export default async function PdfUploadTestPage() {
    const tNav = await getTranslations('Nav');
    return <Page title={tNav('pdfUploadTest')} />;
}
