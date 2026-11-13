'use client';

import { Page } from '@/components/client/Page';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useDeleteAllDocuments, useDeleteDocument, useDocuments, useUploadDocument } from '@/hooks/useDocuments';
import { useErrorMessage } from '@/i18n/errors';
import { trpcClient } from '@/lib/trpc';
import { useFormatter, useTranslations } from 'next-intl';
import { AlertCircle, Download, FileText, Loader2, Trash2, Upload } from 'lucide-react';
import { useRef, useState, type ChangeEvent } from 'react';
import { toast } from 'sonner';

const MAX_SIZE_BYTES = 10 * 1024 * 1024;

const formatBytes = (bytes: number): string => {
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    const units = ['KB', 'MB', 'GB', 'TB'];
    let value = bytes / 1024;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex += 1;
    }
    return `${value.toFixed(1)} ${units[unitIndex]}`;
};

function DownloadButton({
    id,
    filename,
    onError,
}: {
    id: string;
    filename: string;
    onError: (message: string) => void;
}) {
    const t = useTranslations('Documents');
    const [busy, setBusy] = useState(false);

    const handleDownload = async () => {
        setBusy(true);
        try {
            const fetched = await trpcClient.getDocument.query({ id });
            const bytes = Uint8Array.from(atob(fetched.content), (char) => char.charCodeAt(0));
            const blob = new Blob([bytes], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = filename;
            anchor.click();
            URL.revokeObjectURL(url);
        } catch {
            onError(t('downloadFailed'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Button variant='outline' size='sm' className='gap-2' disabled={busy} onClick={handleDownload}>
            {busy ? <Loader2 className='h-4 w-4 animate-spin' /> : <Download className='h-4 w-4' />}
            {busy ? t('downloading') : t('download')}
        </Button>
    );
}

export default function PdfUploadTestPage() {
    const t = useTranslations('Documents');
    const tNav = useTranslations('Nav');
    const tc = useTranslations('Common');
    const showError = useErrorMessage();
    const format = useFormatter();

    const fileInputRef = useRef<HTMLInputElement>(null);
    const [pendingFile, setPendingFile] = useState<File | null>(null);
    const [clientError, setClientError] = useState<string | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
    const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);

    const { documents, isLoading } = useDocuments();
    const upload = useUploadDocument();
    const deleteDocument = useDeleteDocument();
    const deleteAllDocuments = useDeleteAllDocuments();

    const validateFile = (file: File): string | null => {
        const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
        if (!isPdf) {
            return t('notPdf');
        }
        if (file.size > MAX_SIZE_BYTES) {
            return t('fileTooLarge');
        }
        return null;
    };

    const handleFileSelect = (file: File) => {
        const validationError = validateFile(file);
        if (validationError) {
            setClientError(validationError);
            setPendingFile(null);
            return;
        }
        setClientError(null);
        setPendingFile(file);
    };

    const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            handleFileSelect(file);
        }
        event.target.value = '';
    };

    const handleUpload = () => {
        if (!pendingFile) {
            return;
        }
        const reader = new FileReader();
        reader.onloadend = () => {
            const dataUrl = reader.result as string;
            const base64 = dataUrl.split(',')[1];
            upload.mutate(
                { filename: pendingFile.name, content: base64 },
                {
                    onSuccess: () => {
                        toast.success(t('uploadSuccess'));
                        setPendingFile(null);
                        setClientError(null);
                    },
                    onError: (error) => setClientError(showError(error)),
                },
            );
        };
        reader.readAsDataURL(pendingFile);
    };

    const confirmDelete = () => {
        if (!deleteTarget) {
            return;
        }
        deleteDocument.mutate(
            { id: deleteTarget },
            {
                onSuccess: () => toast.success(t('deleteSuccess')),
                onError: (error) => setClientError(showError(error)),
                onSettled: () => setDeleteTarget(null),
            },
        );
    };

    const handleDeleteAll = () => {
        deleteAllDocuments.mutate(undefined, {
            onSuccess: () => toast.success(t('deleteAllSuccess')),
            onError: (error) => setClientError(showError(error)),
            onSettled: () => setConfirmDeleteAll(false),
        });
    };

    const isUploading = upload.isPending;

    return (
        <Page title={tNav('pdfUploadTest')}>
            <div className='space-y-6'>
                <section className='space-y-3 rounded-lg border border-border p-4'>
                    <div className='flex items-center gap-2'>
                        <FileText className='h-5 w-5 text-muted-foreground' />
                        <h2 className='text-lg font-semibold'>{t('upload')}</h2>
                    </div>
                    <p className='text-muted-foreground text-sm'>{t('hint')}</p>

                    {pendingFile ? (
                        <div className='space-y-3'>
                            <div className='flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm'>
                                <span className='truncate'>{pendingFile.name}</span>
                                <span className='ml-auto shrink-0 text-muted-foreground'>
                                    {formatBytes(pendingFile.size)}
                                </span>
                            </div>
                            <div className='flex gap-2'>
                                <Button onClick={handleUpload} disabled={isUploading} className='gap-2'>
                                    {isUploading ? (
                                        <Loader2 className='h-4 w-4 animate-spin' />
                                    ) : (
                                        <Upload className='h-4 w-4' />
                                    )}
                                    {isUploading ? t('uploading') : t('uploadNow')}
                                </Button>
                                <Button variant='outline' onClick={() => setPendingFile(null)} disabled={isUploading}>
                                    {tc('cancel')}
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <Button variant='outline' onClick={() => fileInputRef.current?.click()} className='gap-2'>
                            <Upload className='h-4 w-4' />
                            {t('chooseFile')}
                        </Button>
                    )}
                    <Input
                        ref={fileInputRef}
                        type='file'
                        accept='application/pdf,.pdf'
                        onChange={handleFileInputChange}
                        className='hidden'
                    />
                </section>

                {clientError && (
                    <Alert variant='destructive'>
                        <AlertCircle className='h-4 w-4' />
                        <AlertDescription>{clientError}</AlertDescription>
                    </Alert>
                )}

                <section className='space-y-2'>
                    <div className='flex items-center justify-between gap-2'>
                        <h2 className='text-lg font-semibold'>{t('documents')}</h2>
                        {!isLoading && documents.length > 0 && (
                            <Button
                                variant='outline'
                                size='sm'
                                className='gap-2 text-destructive hover:text-destructive'
                                onClick={() => setConfirmDeleteAll(true)}
                                disabled={deleteAllDocuments.isPending || deleteDocument.isPending}
                            >
                                {deleteAllDocuments.isPending ? (
                                    <Loader2 className='h-4 w-4 animate-spin' />
                                ) : (
                                    <Trash2 className='h-4 w-4' />
                                )}
                                {t('deleteAll')}
                            </Button>
                        )}
                    </div>

                    {isLoading ? (
                        <div className='space-y-2'>
                            <Skeleton className='h-10 w-full' />
                            <Skeleton className='h-10 w-full' />
                        </div>
                    ) : documents.length === 0 ? (
                        <div className='rounded-lg border border-dashed border-border p-8 text-center text-muted-foreground'>
                            {t('noDocuments')}
                        </div>
                    ) : (
                        <div className='rounded-lg border border-border'>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>{t('fileName')}</TableHead>
                                        <TableHead>{t('fileSize')}</TableHead>
                                        <TableHead>{t('uploadedAt')}</TableHead>
                                        <TableHead className='text-right'>{t('actions')}</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {documents.map((doc) => (
                                        <TableRow key={doc.id}>
                                            <TableCell className='max-w-70 truncate font-medium'>
                                                {doc.filename}
                                            </TableCell>
                                            <TableCell>{formatBytes(doc.byteSize)}</TableCell>
                                            <TableCell>
                                                {format.dateTime(new Date(doc.createdAt), 'timestamp')}
                                            </TableCell>
                                            <TableCell>
                                                <div className='flex items-center justify-end gap-2'>
                                                    <DownloadButton
                                                        id={doc.id}
                                                        filename={doc.filename}
                                                        onError={setClientError}
                                                    />
                                                    <Button
                                                        variant='ghost'
                                                        size='icon'
                                                        className='text-destructive hover:text-destructive'
                                                        onClick={() => setDeleteTarget(doc.id)}
                                                        disabled={deleteDocument.isPending}
                                                    >
                                                        <Trash2 className='h-4 w-4' />
                                                    </Button>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </section>
            </div>

            <Dialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t('confirmDeleteTitle')}</DialogTitle>
                        <DialogDescription>{t('confirmDeleteDescription')}</DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant='outline' onClick={() => setDeleteTarget(null)}>
                            {tc('cancel')}
                        </Button>
                        <Button variant='destructive' onClick={confirmDelete} disabled={deleteDocument.isPending}>
                            {t('delete')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={confirmDeleteAll} onOpenChange={(open) => !open && setConfirmDeleteAll(false)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t('confirmDeleteAllTitle')}</DialogTitle>
                        <DialogDescription>{t('confirmDeleteAllDescription')}</DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant='outline' onClick={() => setConfirmDeleteAll(false)}>
                            {tc('cancel')}
                        </Button>
                        <Button variant='destructive' onClick={handleDeleteAll} disabled={deleteAllDocuments.isPending}>
                            {t('deleteAll')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Page>
    );
}
