import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pdfToMarkdownPages, PdfConversionError } from '../src/server/pdf2md';
import type { PdfMarkdownPage } from '../src/server/pdf2md';

const fixtures = join(process.cwd(), 'tests/fixtures/pdf');
const normalize = (text: string) =>
    text
        .replace(/\\([\p{P}\p{S}])/gu, '$1')
        .replace(/\s+/g, ' ')
        .trim();

function checkPages(pages: PdfMarkdownPage[], count: number): void {
    assert.equal(pages.length, count);
    assert.deepEqual(
        pages.map((page) => page.pageNumber),
        Array.from({ length: count }, (_, i) => i + 1),
    );
    for (const page of pages) {
        assert.doesNotMatch(page.markdown, /!\[|<img\b|data:image\//i);
    }
}

function checkNative(text: string): void {
    assert.match(text, /Native English text stays readable/);
    assert.match(text, /Die Rechnung ist bezahlt/);
    assert.match(text, /Figure caption remains native text/);
    assert.match(text, /\|[^\n]*Product[^\n]*\|[^\n]*Quantity/);
    assert.match(text, /\|[^\n]*Apples[^\n]*\|[^\n]*12/);
    assert.match(text, /\|[^\n]*Pears[^\n]*\|[^\n]*7/);
}

function checkOcr(text: string): void {
    const plain = normalize(text);
    assert.match(plain, /Scanned English text is readable/);
    assert.match(plain, /The invoice has been paid in full/);
    assert.match(plain, /Deutscher Scan: Die Rechnung ist bezahlt/);
    assert.match(plain, /Grüße aus Köln für zwölf Gäste/);
    assert.match(text, /\\\[invoice\\\]/);
    assert.match(text, /&lt;tag&gt;/);
}

async function main(): Promise<void> {
    const started = performance.now();
    const digital = await pdfToMarkdownPages(await readFile(join(fixtures, 'digital.pdf')));
    checkPages(digital, 1);
    checkNative(digital[0].markdown);

    const scanned = await pdfToMarkdownPages(await readFile(join(fixtures, 'scanned.pdf')));
    checkPages(scanned, 1);
    checkOcr(scanned[0].markdown);

    const mixed = await pdfToMarkdownPages(await readFile(join(fixtures, 'mixed.pdf')));
    checkPages(mixed, 4);
    checkNative(mixed[0].markdown);
    checkOcr(mixed[1].markdown);
    assert.equal(mixed[2].markdown, '');
    assert.match(mixed[3].markdown, /Last native page after the blank page/);

    await assert.rejects(pdfToMarkdownPages(Buffer.from('invalid pdf')), PdfConversionError);
    await assert.rejects(pdfToMarkdownPages(new Uint8Array()), /PDF input is empty/);
    console.log(
        `PDF smoke passed: native text, tables, German/English OCR, images omitted, all pages preserved (${Math.round(performance.now() - started)} ms).`,
    );
}

void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
});
