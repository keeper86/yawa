import { getCaller, getDb, testUsers } from 'tests/vitest/setupTestcontainer';
import { createHash, randomUUID } from 'crypto';
import { beforeAll, describe, expect, it } from 'vitest';

type DocumentBlobLoader = typeof import('@/server/storage/documentBlobs').load;

let load: DocumentBlobLoader;

beforeAll(async () => {
    ({ load } = await import('@/server/storage/documentBlobs'));
});

const MAX_SIZE_BYTES_DOCUMENT = 10 * 1024 * 1024;
const PDF_MIME_TYPE = 'application/pdf';
const PDF_SIGNATURE = Buffer.from('%PDF-');

const encodeBase64 = (content: string) => Buffer.from(content, 'utf8').toString('base64');

const validPdfBase64 = (suffix: string) => encodeBase64(`%PDF-1.4\n${suffix}\n%%EOF`);

const uploadPdf = (filename: string, content: string) =>
    getCaller().uploadDocument({ filename, mimeType: PDF_MIME_TYPE, content });

describe('document endpoints (integration)', () => {
    it('stores an uploaded pdf and returns a summary without content', async () => {
        const caller = getCaller();

        const summary = await caller.uploadDocument({
            filename: 'report.pdf',
            mimeType: PDF_MIME_TYPE,
            content: validPdfBase64('hello-report'),
        });

        expect(summary.id).toBeTruthy();
        expect(summary.filename).toBe('report.pdf');
        expect(summary.byteSize).toBe(Buffer.from('%PDF-1.4\nhello-report\n%%EOF', 'utf8').length);
        expect(summary.pageCount).toBeNull();
        expect(summary.createdAt).toBeTruthy();
    });

    it('dedupes an identical upload by content hash', async () => {
        const caller = getCaller();
        const content = validPdfBase64('dedupe-me');

        const first = await caller.uploadDocument({ filename: 'first.pdf', mimeType: PDF_MIME_TYPE, content });
        const second = await caller.uploadDocument({ filename: 'second.pdf', mimeType: PDF_MIME_TYPE, content });

        expect(second.id).toBe(first.id);
    });

    it('lists documents for the user in descending creation order', async () => {
        const caller = getCaller();
        const db = getDb();

        const older = await uploadPdf('older.pdf', validPdfBase64('older'));
        const newer = await uploadPdf('newer.pdf', validPdfBase64('newer'));

        await db('documents')
            .where({ id: older.id })
            .update({ created_at: new Date('2026-01-01T00:00:00Z') });
        await db('documents')
            .where({ id: newer.id })
            .update({ created_at: new Date('2026-02-01T00:00:00Z') });

        try {
            const { documents } = await caller.listDocuments();
            const olderIndex = documents.findIndex((doc) => doc.id === older.id);
            const newerIndex = documents.findIndex((doc) => doc.id === newer.id);

            expect(olderIndex).toBeGreaterThanOrEqual(0);
            expect(newerIndex).toBeGreaterThanOrEqual(0);
            expect(newerIndex).toBeLessThan(olderIndex);
        } finally {
            await db('documents').whereIn('id', [older.id, newer.id]).del();
        }
    });

    it('persists the decoded bytes, hash, pending status and null page count', async () => {
        const source = Buffer.from('%PDF-1.4\npersisted\n%%EOF', 'utf8');
        const uploaded = await uploadPdf('persisted.pdf', source.toString('base64'));

        const storedBlob = await load({ userId: testUsers.testUser.user_id, documentId: uploaded.id });
        expect(storedBlob?.equals(source)).toBe(true);

        const row = await getDb()('documents')
            .select('content_sha256', 'byte_size', 'page_count', 'status')
            .where({ id: uploaded.id })
            .first();

        expect(row).toMatchObject({
            content_sha256: createHash('sha256').update(source).digest('hex'),
            byte_size: source.length,
            page_count: null,
            status: 'pending',
        });

        await getDb()('documents').where({ id: uploaded.id }).del();
    });

    it('hides another users document from the requester', async () => {
        const other = getCaller(testUsers.otherUser.user_id);
        const uploaded = await other.uploadDocument({
            filename: 'secret.pdf',
            mimeType: PDF_MIME_TYPE,
            content: validPdfBase64('secret'),
        });

        expect(await load({ userId: testUsers.testUser.user_id, documentId: uploaded.id })).toBeNull();
        await expect(getCaller().deleteDocument({ id: uploaded.id })).rejects.toThrow();

        const db = getDb();
        await db('documents').where({ id: uploaded.id }).del();
    });

    it('deletes a document', async () => {
        const caller = getCaller();
        const uploaded = await caller.uploadDocument({
            filename: 'gone.pdf',
            mimeType: PDF_MIME_TYPE,
            content: validPdfBase64('delete-me'),
        });

        await caller.deleteDocument({ id: uploaded.id });

        expect(await load({ userId: testUsers.testUser.user_id, documentId: uploaded.id })).toBeNull();
        const { documents } = await caller.listDocuments();
        expect(documents.some((doc) => doc.id === uploaded.id)).toBe(false);
    });

    it('deletes all documents of the user and leaves other users documents untouched', async () => {
        const caller = getCaller();
        const other = getCaller(testUsers.otherUser.user_id);
        const db = getDb();

        const first = await uploadPdf('first.pdf', validPdfBase64('wipe-1'));
        const second = await uploadPdf('second.pdf', validPdfBase64('wipe-2'));
        const otherDoc = await other.uploadDocument({
            filename: 'other.pdf',
            mimeType: PDF_MIME_TYPE,
            content: validPdfBase64('wipe-other'),
        });

        try {
            await caller.deleteAllDocuments();

            const { documents } = await caller.listDocuments();
            expect(documents.some((doc) => [first.id, second.id].includes(doc.id))).toBe(false);

            expect(await load({ userId: testUsers.testUser.user_id, documentId: first.id })).toBeNull();
            expect(await load({ userId: testUsers.testUser.user_id, documentId: second.id })).toBeNull();
            expect(await load({ userId: testUsers.otherUser.user_id, documentId: otherDoc.id })).not.toBeNull();
        } finally {
            await db('documents').whereIn('id', [first.id, second.id, otherDoc.id]).del();
        }
    });

    it('rejects a file that is not a pdf', async () => {
        await expect(uploadPdf('notpdf.pdf', encodeBase64('this is plain text, not a pdf'))).rejects.toMatchObject({
            code: 'UNSUPPORTED_MEDIA_TYPE',
        });
    });

    it('rejects a declared mime type other than pdf even when the bytes are a pdf', async () => {
        await expect(
            getCaller().uploadDocument({
                filename: 'mislabelled.pdf',
                mimeType: 'text/plain',
                content: validPdfBase64('mime-mismatch'),
            }),
        ).rejects.toMatchObject({ code: 'UNSUPPORTED_MEDIA_TYPE' });
    });

    it('rejects malformed base64 before decoding', async () => {
        await expect(
            getCaller().uploadDocument({
                filename: 'malformed.pdf',
                mimeType: PDF_MIME_TYPE,
                content: 'JVBERi0 this is not base64!',
            }),
        ).rejects.toMatchObject({ code: 'UNSUPPORTED_MEDIA_TYPE' });
    });

    it('rejects non-canonical base64 before decoding', async () => {
        await expect(
            getCaller().uploadDocument({
                filename: 'noncanonical.pdf',
                mimeType: PDF_MIME_TYPE,
                content: 'JVBERi1=',
            }),
        ).rejects.toMatchObject({ code: 'UNSUPPORTED_MEDIA_TYPE' });
    });

    it('rejects an oversized pdf', async () => {
        const oversized = `JVBERi0${'A'.repeat(14_000_000)}`;

        await expect(uploadPdf('huge.pdf', oversized)).rejects.toThrow();
    });

    it('rejects a pdf that exceeds the decoded size limit while fitting the base64 limit', async () => {
        const buffer = Buffer.alloc(MAX_SIZE_BYTES_DOCUMENT + 2);
        PDF_SIGNATURE.copy(buffer);
        const content = buffer.toString('base64');

        expect(content.length).toBe(4 * Math.ceil(MAX_SIZE_BYTES_DOCUMENT / 3));

        await expect(uploadPdf('huge-decoded.pdf', content)).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
    });

    it('rejects deleting an unknown document with a valid uuid', async () => {
        const caller = getCaller();

        await expect(caller.deleteDocument({ id: randomUUID() })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('rejects a malformed document id', async () => {
        const caller = getCaller();

        await expect(caller.deleteDocument({ id: 'not-a-uuid' })).rejects.toThrow();
    });
});
