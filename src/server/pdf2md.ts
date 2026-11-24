import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page, Rect } from 'mupdf';
import type { Worker } from 'tesseract.js';

export interface PdfMarkdownPage {
    /** One-based physical page position, including blank pages. */
    pageNumber: number;
    markdown: string;
}

export class PdfConversionError extends Error {
    constructor(
        message: string,
        public readonly cause: unknown = undefined,
    ) {
        super(message);
        this.name = 'PdfConversionError';
    }
}

const OCR_DPI = 300;
const SCAN_COVERAGE = 0.5;
const SPARSE_TEXT_LENGTH = 200;

function area([x0, y0, x1, y1]: Rect): number {
    return Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
}

function needsOcr(page: Page): boolean {
    const text = page.toStructuredText('preserve-images');
    try {
        const nativeLength = text.asText().replace(/\s/g, '').length;
        const bounds = page.getBounds();
        const pageArea = area(bounds);
        let largestImageArea = 0;
        text.walk({
            onImageBlock(bbox, _transform, image) {
                try {
                    // Clip to the page: images can extend beyond its visible bounds.
                    largestImageArea = Math.max(
                        largestImageArea,
                        area([
                            Math.max(bounds[0], bbox[0]),
                            Math.max(bounds[1], bbox[1]),
                            Math.min(bounds[2], bbox[2]),
                            Math.min(bounds[3], bbox[3]),
                        ]),
                    );
                } finally {
                    image.destroy();
                }
            },
        });
        return (
            largestImageArea > 0 &&
            (nativeLength === 0 || (nativeLength < SPARSE_TEXT_LENGTH && largestImageArea >= pageArea * SCAN_COVERAGE))
        );
    } finally {
        text.destroy();
    }
}

async function createOcrWorker(): Promise<Worker> {
    const { createWorker, OEM, PSM } = await import('tesseract.js');
    // Use Node's resolver directly: bundlers otherwise rewrite createRequire/resolve calls.
    const runtimeRequire = process.getBuiltinModule('module').createRequire(join(process.cwd(), 'package.json'));
    const languagePath = await mkdtemp(join(tmpdir(), 'yawa-ocr-'));
    let worker: Worker | undefined;
    try {
        // Tesseract needs both models in one directory; its Lang[] byte API is broken in v7.
        await Promise.all(
            ['deu', 'eng'].map((language) =>
                copyFile(
                    runtimeRequire.resolve(`@tesseract.js-data/${language}/4.0.0_best_int/${language}.traineddata.gz`),
                    join(languagePath, `${language}.traineddata.gz`),
                ),
            ),
        );
        worker = await createWorker(['deu', 'eng'], OEM.LSTM_ONLY, {
            langPath: languagePath,
            cacheMethod: 'none',
            // Recognition errors already reject their promise; the default handler also throws globally.
            errorHandler: () => {},
        });
        await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO, user_defined_dpi: String(OCR_DPI) });
        return worker;
    } catch (error) {
        await worker?.terminate();
        throw error;
    } finally {
        // Models are now in the worker's memory. Nothing is cached in the app directory.
        await rm(languagePath, { recursive: true, force: true });
    }
}

function ocrMarkdown(text: string): string {
    // OCR is plain text: preserve literal punctuation rather than accidentally creating Markdown/HTML.
    return text
        .replace(/\r\n?/g, '\n')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/([\\`*_[\]{}()#+.!|~-])/g, '\\$1')
        .trim();
}

/** Extract native Markdown and fall back to German/English OCR on scanned pages. Node.js only. */
export async function pdfToMarkdownPages(pdf: Uint8Array): Promise<PdfMarkdownPage[]> {
    if (!(pdf instanceof Uint8Array)) {
        throw new TypeError('PDF input must be a Uint8Array or Buffer.');
    }
    if (pdf.byteLength === 0) {
        throw new PdfConversionError('PDF input is empty.');
    }

    const [mupdf, { toMarkdownPages }] = await Promise.all([import('mupdf'), import('@nalinor/mupdf4llm')]);
    let document: InstanceType<typeof mupdf.Document> | undefined;
    let worker: Worker | undefined;
    try {
        document = mupdf.Document.openDocument(pdf, 'application/pdf');
        if (!document.isPDF()) {
            throw new PdfConversionError('Input is not a PDF document.');
        }
        if (document.needsPassword()) {
            throw new PdfConversionError('Password-protected PDFs are not supported.');
        }

        const chunks = await toMarkdownPages(pdf, {
            writeImages: false,
            embedImages: false,
            // Disable the library's optional RapidOCR table engine; Tesseract handles scanned pages below.
            textSource: 'pdf',
        });
        if (chunks.length !== document.countPages()) {
            throw new PdfConversionError('PDF extraction returned an unexpected number of pages.');
        }

        const pages: PdfMarkdownPage[] = [];
        for (let index = 0; index < chunks.length; index++) {
            let page: Page | undefined;
            try {
                page = document.loadPage(index);
                let markdown = chunks[index].text.trim();
                if (needsOcr(page)) {
                    worker ??= await createOcrWorker();
                    const pixmap = page.toPixmap(
                        mupdf.Matrix.scale(OCR_DPI / 72, OCR_DPI / 72),
                        mupdf.ColorSpace.DeviceRGB,
                        false,
                    );
                    let png: Uint8Array;
                    try {
                        png = pixmap.asPNG();
                    } finally {
                        pixmap.destroy();
                    }
                    const { data } = await worker.recognize(Buffer.from(png));
                    markdown = ocrMarkdown(data.text);
                }
                pages.push({ pageNumber: index + 1, markdown });
            } catch (cause) {
                throw new PdfConversionError(`PDF conversion failed on page ${index + 1}.`, cause);
            } finally {
                page?.destroy();
            }
        }
        return pages;
    } catch (cause) {
        if (cause instanceof PdfConversionError) {
            throw cause;
        }
        throw new PdfConversionError('PDF conversion failed.', cause);
    } finally {
        try {
            await worker?.terminate();
        } finally {
            document?.destroy();
        }
    }
}
