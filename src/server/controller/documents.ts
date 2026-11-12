import type { Documents } from '@/types/db_schemas';
import { createHash } from 'crypto';
import z from 'zod';
import { db } from '../db';
import { logger } from '../logger';
import { domainError } from '../domainError';
import { getUserIdFromContext, protectedProcedure } from '../trpcRoot';

const MAX_SIZE_BYTES_DOCUMENT = 10 * 1024 * 1024;
const bytesToBase64Chars = (bytes: number) => 4 * Math.ceil(bytes / 3);
const PDF_SIGNATURE = Buffer.from('%PDF-');

const isPdf = (buffer: Buffer): boolean =>
    buffer.length >= PDF_SIGNATURE.length && buffer.subarray(0, 5).equals(PDF_SIGNATURE);
const sha256 = (buffer: Buffer): string => createHash('sha256').update(buffer).digest('hex');

const uploadInput = z.object({
    filename: z.string().min(1).max(255),
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

const singleDocument = documentSummary.extend({
    content: z.string(),
});
export type SingleDocument = z.infer<typeof singleDocument>;

const toSummary = (row: Omit<Documents, 'content'>): DocumentSummary => ({
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
            const buffer = Buffer.from(input.content, 'base64');

            if (!isPdf(buffer)) {
                throw domainError('UNSUPPORTED_MEDIA_TYPE', 'documentNotPdf', 'Only PDF files are supported');
            }

            if (buffer.length > MAX_SIZE_BYTES_DOCUMENT) {
                throw domainError('PAYLOAD_TOO_LARGE', 'documentTooLarge', 'PDF file size must be less than 10MB');
            }

            const contentSha256 = sha256(buffer);
            logger.debug(
                { component: 'document-upload' },
                `Storing document for user ${userId} (${buffer.length} bytes)`,
            );

            await db('documents')
                .insert({
                    user_id: userId,
                    filename: input.filename,
                    content_sha256: contentSha256,
                    byte_size: buffer.length,
                    page_count: null,
                    content: buffer,
                })
                .onConflict(['user_id', 'content_sha256'])
                .ignore();

            const row = await db('documents').where({ user_id: userId, content_sha256: contentSha256 }).first();
            if (!row) {
                throw domainError('NOT_FOUND', 'documentNotFound', 'Document not found');
            }
            return toSummary(row);
        });
};

export const listDocuments = () => {
    return protectedProcedure
        .input(z.void())
        .output(z.object({ documents: z.array(documentSummary) }))
        .query(async ({ ctx }) => {
            const userId = getUserIdFromContext(ctx);
            const rows = (await db('documents').where({ user_id: userId }).orderBy('created_at', 'desc')) as Array<
                Omit<Documents, 'content'>
            >;

            return { documents: rows.map(toSummary) };
        });
};

export const getDocument = () => {
    return protectedProcedure
        .input(z.object({ id: z.string() }))
        .output(singleDocument)
        .query(async ({ input, ctx }) => {
            const userId = getUserIdFromContext(ctx);
            const row = await db('documents').where({ user_id: userId, id: input.id }).first();

            if (!row) {
                throw domainError('NOT_FOUND', 'documentNotFound', 'Document not found');
            }

            return {
                ...toSummary(row),
                content: row.content.toString('base64'),
            };
        });
};

export const deleteDocument = () => {
    return protectedProcedure
        .input(z.object({ id: z.string() }))
        .output(z.void())
        .mutation(async ({ input, ctx }) => {
            const userId = getUserIdFromContext(ctx);
            const deleted = await db('documents').where({ user_id: userId, id: input.id }).delete();

            if (deleted === 0) {
                throw domainError('NOT_FOUND', 'documentNotFound', 'Document not found');
            }
        });
};
