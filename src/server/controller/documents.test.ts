import { getCaller, getDb, testUsers } from 'tests/vitest/setupTestcontainer';
import { createHash } from 'crypto';
import { describe, expect, it } from 'vitest';

const encodeBase64 = (content: string) => Buffer.from(content, 'utf8').toString('base64');

const validPdfBase64 = (suffix: string) => encodeBase64(`%PDF-1.4\n${suffix}\n%%EOF`);

describe('document endpoints (integration)', () => {
    it('stores an uploaded pdf and returns a summary without content', async () => {
        const caller = getCaller();

        const summary = await caller.uploadDocument({
            filename: 'report.pdf',
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

        const first = await caller.uploadDocument({ filename: 'first.pdf', content });
        const second = await caller.uploadDocument({ filename: 'second.pdf', content });

        expect(second.id).toBe(first.id);
    });

    it('lists documents for the user in descending creation order', async () => {
        const caller = getCaller();
        const db = getDb();

        const older = await caller.uploadDocument({ filename: 'older.pdf', content: validPdfBase64('older') });
        const newer = await caller.uploadDocument({ filename: 'newer.pdf', content: validPdfBase64('newer') });

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

    it('returns the base64 content for a stored document', async () => {
        const caller = getCaller();
        const source = validPdfBase64('download-me');
        const uploaded = await caller.uploadDocument({ filename: 'dl.pdf', content: source });

        const fetched = await caller.getDocument({ id: uploaded.id });
        expect(fetched.id).toBe(uploaded.id);
        expect(fetched.content).toBe(source);

        const db = getDb();
        await db('documents').where({ id: uploaded.id }).del();
    });

    it('hides another users document from the requester', async () => {
        const other = getCaller(testUsers.otherUser.user_id);
        const uploaded = await other.uploadDocument({ filename: 'secret.pdf', content: validPdfBase64('secret') });

        await expect(getCaller().getDocument({ id: uploaded.id })).rejects.toThrow();
        await expect(getCaller().deleteDocument({ id: uploaded.id })).rejects.toThrow();

        const db = getDb();
        await db('documents').where({ id: uploaded.id }).del();
    });

    it('deletes a document', async () => {
        const caller = getCaller();
        const uploaded = await caller.uploadDocument({ filename: 'gone.pdf', content: validPdfBase64('delete-me') });

        await caller.deleteDocument({ id: uploaded.id });

        await expect(caller.getDocument({ id: uploaded.id })).rejects.toThrow();
        const { documents } = await caller.listDocuments();
        expect(documents.some((doc) => doc.id === uploaded.id)).toBe(false);
    });

    it('deletes all documents of the user and leaves other users documents untouched', async () => {
        const caller = getCaller();
        const other = getCaller(testUsers.otherUser.user_id);
        const db = getDb();

        const first = await caller.uploadDocument({ filename: 'first.pdf', content: validPdfBase64('wipe-1') });
        const second = await caller.uploadDocument({ filename: 'second.pdf', content: validPdfBase64('wipe-2') });
        const otherDoc = await other.uploadDocument({ filename: 'other.pdf', content: validPdfBase64('wipe-other') });

        try {
            await caller.deleteAllDocuments();

            const { documents } = await caller.listDocuments();
            expect(documents.some((doc) => [first.id, second.id].includes(doc.id))).toBe(false);

            await expect(caller.getDocument({ id: first.id })).rejects.toThrow();
            await expect(other.getDocument({ id: otherDoc.id })).resolves.toMatchObject({ id: otherDoc.id });
        } finally {
            await db('documents').whereIn('id', [first.id, second.id, otherDoc.id]).del();
        }
    });

    it('rejects a file that is not a pdf', async () => {
        const caller = getCaller();

        await expect(
            caller.uploadDocument({ filename: 'notpdf.pdf', content: encodeBase64('this is plain text, not a pdf') }),
        ).rejects.toThrow();
    });

    it('rejects an oversized pdf', async () => {
        const caller = getCaller();
        const oversized = `JVBERi0${'A'.repeat(14_000_000)}`;

        await expect(caller.uploadDocument({ filename: 'huge.pdf', content: oversized })).rejects.toThrow();
    });

    it('rejects getting or deleting an unknown document', async () => {
        const caller = getCaller();
        const missing = createHash('sha256').update('never-uploaded').digest('hex');

        await expect(caller.getDocument({ id: missing })).rejects.toThrow();
        await expect(caller.deleteDocument({ id: missing })).rejects.toThrow();
    });

    it('rejects a malformed document id', async () => {
        const caller = getCaller();

        await expect(caller.getDocument({ id: 'not-a-uuid' })).rejects.toThrow();
        await expect(caller.deleteDocument({ id: 'not-a-uuid' })).rejects.toThrow();
    });
});
