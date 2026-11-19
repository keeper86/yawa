import type { Documents } from '@/types/db_schemas';
import { createHash } from 'crypto';
import { db } from '../db';

export const DOCUMENT_METADATA_COLUMNS = ['id', 'filename', 'byte_size', 'page_count', 'created_at'] as const;

export type DocumentMetadata = Pick<Documents, (typeof DOCUMENT_METADATA_COLUMNS)[number]>;

type SaveDocumentBlobInput = {
    userId: string;
    filename: string;
    content: Buffer;
};

type DocumentBlobRef = {
    userId: string;
    documentId: string;
};

export const save = async ({ userId, filename, content }: SaveDocumentBlobInput): Promise<DocumentMetadata | null> => {
    const contentSha256 = createHash('sha256').update(content).digest('hex');

    await db('documents')
        .insert({
            user_id: userId,
            filename,
            content_sha256: contentSha256,
            byte_size: content.length,
            page_count: null,
            content,
        })
        .onConflict(['user_id', 'content_sha256'])
        .ignore();

    const row = (await db('documents')
        .select(...DOCUMENT_METADATA_COLUMNS)
        .where({ user_id: userId, content_sha256: contentSha256 })
        .first()) as DocumentMetadata | undefined;

    return row ?? null;
};

export const load = async ({ userId, documentId }: DocumentBlobRef): Promise<Buffer | null> => {
    const row = (await db('documents').select('content').where({ user_id: userId, id: documentId }).first()) as
        Pick<Documents, 'content'> | undefined;

    return row?.content ?? null;
};

export const remove = async ({ userId, documentId }: DocumentBlobRef): Promise<number> => {
    const deleted = await db('documents').where({ user_id: userId, id: documentId }).delete();
    return deleted;
};

export const removeAll = async (userId: string): Promise<number> => {
    const deleted = await db('documents').where({ user_id: userId }).delete();
    return deleted;
};
