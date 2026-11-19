import z from 'zod';
import { db } from '../db';
import { logger } from '../logger';
import { domainError } from '../domainError';
import { DOCUMENT_METADATA_COLUMNS, remove, removeAll, save } from '../storage/documentBlobs';
import type { DocumentMetadata } from '../storage/documentBlobs';
import { getUserIdFromContext, protectedProcedure } from '../trpcRoot';

const MAX_SIZE_BYTES_DOCUMENT = 10 * 1024 * 1024;
const bytesToBase64Chars = (bytes: number) => 4 * Math.ceil(bytes / 3);
const PDF_SIGNATURE = Buffer.from('%PDF-');
const PDF_MIME_TYPE = 'application/pdf';

const isBase64Char = (charCode: number): boolean =>
    (charCode >= 65 && charCode <= 90) ||
    (charCode >= 97 && charCode <= 122) ||
    (charCode >= 48 && charCode <= 57) ||
    charCode === 43 ||
    charCode === 47;

const isBase64 = (content: string): boolean => {
    if (content.length % 4 !== 0) {
        return false;
    }

    const padding = content.endsWith('==') ? 2 : content.endsWith('=') ? 1 : 0;
    for (let index = 0; index < content.length - padding; index += 1) {
        if (!isBase64Char(content.charCodeAt(index))) {
            return false;
        }
    }

    return true;
};

const isPdf = (buffer: Buffer): boolean =>
    buffer.length >= PDF_SIGNATURE.length && buffer.subarray(0, 5).equals(PDF_SIGNATURE);

const decodeBase64 = (content: string): Buffer => {
    if (!isBase64(content)) {
        throw domainError('UNSUPPORTED_MEDIA_TYPE', 'invalidDocumentData', 'Invalid base64 document data');
    }

    const buffer = Buffer.from(content, 'base64');
    if (buffer.toString('base64') !== content) {
        throw domainError('UNSUPPORTED_MEDIA_TYPE', 'invalidDocumentData', 'Invalid base64 document data');
    }

    return buffer;
};

const uploadInput = z.object({
    filename: z.string().min(1).max(255),
    mimeType: z.string().min(1).max(255),
    content: z.string().max(bytesToBase64Chars(MAX_SIZE_BYTES_DOCUMENT), 'Document (base64) is too large'),
});

const documentSummary = z.object({
    id: z.string(),
    filename: z.string(),
    byteSize: z.number(),
    pageCount: z.number().nullable(),
    createdAt: z.string(),
});
export type DocumentSummary = z.infer<typeof documentSummary>;

const toSummary = (row: DocumentMetadata): DocumentSummary => ({
    id: row.id,
    filename: row.filename,
    byteSize: row.byte_size,
    pageCount: row.page_count,
    createdAt: row.created_at.toISOString(),
});

export const uploadDocument = () => {
    return protectedProcedure
        .input(uploadInput)
        .output(documentSummary)
        .mutation(async ({ input, ctx }) => {
            const userId = getUserIdFromContext(ctx);

            if (input.mimeType !== PDF_MIME_TYPE) {
                throw domainError('UNSUPPORTED_MEDIA_TYPE', 'documentNotPdf', 'Only PDF files are supported');
            }

            const buffer = decodeBase64(input.content);

            if (!isPdf(buffer)) {
                throw domainError('UNSUPPORTED_MEDIA_TYPE', 'documentNotPdf', 'Only PDF files are supported');
            }

            if (buffer.length > MAX_SIZE_BYTES_DOCUMENT) {
                throw domainError('PAYLOAD_TOO_LARGE', 'documentTooLarge', 'PDF file size must be less than 10MB');
            }

            logger.debug(
                { component: 'document-upload' },
                `Storing document for user ${userId} (${buffer.length} bytes)`,
            );

            const stored = await save({ userId, filename: input.filename, content: buffer });
            if (!stored) {
                throw domainError('NOT_FOUND', 'documentNotFound', 'Document not found');
            }
            return toSummary(stored);
        });
};

export const listDocuments = () => {
    return protectedProcedure
        .input(z.void())
        .output(z.object({ documents: z.array(documentSummary) }))
        .query(async ({ ctx }) => {
            const userId = getUserIdFromContext(ctx);
            const rows = (await db('documents')
                .select(...DOCUMENT_METADATA_COLUMNS)
                .where({ user_id: userId })
                .orderBy('created_at', 'desc')) as DocumentMetadata[];

            return { documents: rows.map(toSummary) };
        });
};

export const deleteDocument = () => {
    return protectedProcedure
        .input(z.object({ id: z.uuid() }))
        .output(z.void())
        .mutation(async ({ input, ctx }) => {
            const userId = getUserIdFromContext(ctx);
            const deleted = await remove({ userId, documentId: input.id });

            if (deleted === 0) {
                throw domainError('NOT_FOUND', 'documentNotFound', 'Document not found');
            }
        });
};

export const deleteAllDocuments = () => {
    return protectedProcedure
        .input(z.void())
        .output(z.void())
        .mutation(async ({ ctx }) => {
            const userId = getUserIdFromContext(ctx);
            const deleted = await removeAll(userId);
            logger.debug(
                { component: 'document-upload' },
                `Deleted all documents for user ${userId} (${deleted} rows)`,
            );
        });
};
