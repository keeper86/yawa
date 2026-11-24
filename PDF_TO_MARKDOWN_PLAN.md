# PDF to Markdown implementation plan

## Scope and decisions

Implement a reusable TypeScript backend function, a local terminal utility following
`tools/embedding_debug.ts`, and an automated smoke test. No upload UI, API endpoint,
database integration, or embedding integration is part of this ticket.

- Use `@nalinor/mupdf4llm` for native PDF text, layout, and table extraction.
- Add `tesseract.js` for German (`deu`) and English (`eng`) OCR.
- Return ordered entries containing a page number and Markdown; a combined `.md` file is
  no longer required.
- Drop image assets and image references. Rendering a scan temporarily for OCR is still
  necessary; those images never become output assets.
- Prefer HTML tables only if the installed library exposes them directly. Otherwise keep
  its Markdown tables. Do not build a custom table converter.
- Preserve the library's extraction behavior rather than promising exact visual fidelity.
- Introduce no application-level page cap or performance target. Process OCR pages
  sequentially; input bytes and returned text still occupy memory.

## Proposed function contract

Add `src/server/pdf2md.ts`:

```ts
export interface PdfMarkdownPage {
    pageNumber: number;
    markdown: string;
}

export async function pdfToMarkdownPages(pdf: Uint8Array): Promise<PdfMarkdownPage[]>;
```

`Buffer` is accepted through `Uint8Array`. File reading belongs to the caller. Page numbers
are one-based physical PDF positions. Return every page in order, including an empty entry
for a blank page; printed page labels such as Roman numerals are not required.

Return only after the whole document succeeds. Invalid, unreadable, password-protected,
or failed conversions reject with a useful error; include the page number for a page-level
failure. Do not silently return partial output.

## Implementation steps

### 1. Verify and pin the dependencies

- Add `@nalinor/mupdf4llm`, `tesseract.js`, and a compatible direct `mupdf` dependency for
  rendering. Pin the resolved versions in `package-lock.json`.
- Check the installed types and implementation for `toMarkdownPages`, page metadata,
  image suppression, table output, document ownership, and cleanup. Normalize the library's
  page entries into the contract above rather than exposing dependency-specific metadata.
- Check for a native HTML table option. The README advertises Markdown conversion and
  table strategies but does not establish an HTML table option; use Markdown unless the
  installed API confirms otherwise.
- Package German and English language data locally, preferably through the matching
  `@tesseract.js-data` packages after verifying their paths and compatibility. Configure
  Tesseract to use those files so conversion and the smoke test need no model download.
- Verify imports, WASM initialization, and worker startup under the repository's Node 24,
  `tsx`, and existing TypeScript configuration before building the wrapper.

### 2. Implement native extraction and OCR fallback

- Use `toMarkdownPages` for native extraction, retaining the library's reading order,
  headings, lists, and detected tables. Disable image export and embedding, and verify
  that the output contains no generated image references.
- Inspect each page's native text and raster-image coverage to identify scan-only or
  scan-dominant pages. A tiny selectable footer must not suppress OCR of a full-page scan.
  Keep this rule small and document the actual thresholds chosen against the fixtures.
- For those pages, render an in-memory PNG using MuPDF at approximately 300 DPI and
  recognize it with a lazily created Tesseract worker configured with both `deu` and `eng`.
  Reuse that worker for the document and explicitly select full-page text segmentation.
- Use OCR text as that page's Markdown content, preserving readable line/paragraph breaks
  and escaping Markdown syntax where necessary. Replace the native result for that page
  rather than appending a duplicate OCR copy.
- Native and scanned pages can coexist in one document. OCR is best effort: it does not
  promise reconstructed headings or structured tables on scans. Arbitrary scanned inserts
  inside otherwise native-text pages are a documented limitation of this first fallback;
  custom region merging and OCR layout reconstruction are outside this ticket.
- Release page, pixmap, and document resources according to the installed API and terminate
  the OCR worker in `finally`, including on failure. Keep module imports free of database,
  authentication, app startup, and worker initialization side effects.

### 3. Add the terminal utility

Add `tools/pdf_debug.ts` and `npm run pdf:debug` using the existing `tsx` convention:

```sh
npm run pdf:debug -- "/path/document.pdf"
npm run pdf:debug -- "/path/document.pdf" --out "/path/document.md"
```

Read the PDF, call the shared function, and combine its pages into readable Markdown with
page headings and separators. `--out` writes that Markdown to a file. Include `--help`,
support paths containing spaces, send diagnostics to stderr, and exit nonzero on invalid
arguments or conversion failure. The backend function still returns separate page entries.

### 4. Add a real smoke test

Add `tools/pdf_smoke.ts`, `npm run pdf:smoke`, and small committed synthetic fixtures under
`tests/fixtures/pdf/`. Test real MuPDF and Tesseract execution through the exported function;
do not mock extraction or OCR.

Cover a digital PDF, an image-only scan, and a mixed document containing native, scanned,
and blank pages. Across these fixtures include English and German text, a native table,
an illustration, and a scan with a small native footer.

Assert:

- Page count, order, and one-based numbers are correct, including blank pages.
- Known native text and clear English/German OCR phrases survive on their correct pages.
- A scan with a native footer still yields the scanned body text.
- The native table preserves its headers and cells in the selected native table format.
- No image references, embedded image data, or exported image assets are produced.
- A corrupt PDF rejects, and repeated calls finish without leaving OCR workers running.

Use whitespace normalization and short phrase assertions instead of whole-output snapshots.
The smoke test runs without PostgreSQL, Ollama, credentials, or network access after dependency
installation. Add it to CI alongside the existing standalone embedding smoke command.

### 5. Ensure future backend callers work in the deployed app

- Backend code must be able to import `pdfToMarkdownPages` from `@/server/pdf2md` and call it
  inside the existing Node 24 Alpine app container. Keep the terminal utility local; no
  separate production command, conversion service, or startup conversion is required.
- Verify Next.js server bundling and standalone packaging retain the MuPDF/Tesseract
  runtime dependencies, WASM files, worker scripts, and both language models when backend
  code imports the function. Adjust `Dockerfile` and `next.config.js` only as needed.
- Resolve bundled models and worker assets reliably under the deployed app's non-root
  user. Avoid runtime model downloads and use a writable cache location or disable cache
  writes when reading bundled models.
- Use a temporary backend caller in a disposable build to verify native extraction and
  German/English OCR through the app's production build and container environment. Remove
  that caller afterward; no permanent endpoint or production smoke entry is required.
  Running the whole Compose stack is not an acceptance criterion for this ticket.

### 6. Document and verify

- Add a short README section showing the function contract, local commands, OCR languages,
  table policy, and scan/mixed-page limitations.
- Run `npm run pdf:smoke`, type-checking, and lint/format checks for the changed files.
  Since `tools/` is excluded from the main TypeScript configuration, execute both utilities
  as part of verification rather than relying on the application type-check alone.
- Manually run `pdf:debug` against a representative local PDF and inspect the resulting
  composed Markdown. If none is available, use the committed fixtures and record that limitation.

## Acceptance criteria

- The shared function accepts PDF bytes and returns one Markdown entry per physical page.
- Native text extraction uses mupdf4llm; German and English scans use real Tesseract OCR.
- Images are omitted and native tables use HTML only if directly supported, otherwise Markdown.
- A standalone smoke command verifies real extraction, OCR, and page preservation.
- A terminal command accepts a PDF path and prints or saves readable Markdown with page numbers.
- A future backend import can call the function in the deployed app, with its worker,
  WASM, and language assets available; verify this with a temporary production caller.

## References

- [mupdf4llm README and per-page API](https://github.com/iamnalinor/mupdf4llm#quick-start)
- [mupdf4llm OCR limitation and MuPDF rendering recipe](https://github.com/iamnalinor/mupdf4llm/blob/main/src/ocr/README.md)
- [Tesseract.js worker, language data, recognition, and cleanup API](https://github.com/naptha/tesseract.js/blob/master/docs/api.md)
