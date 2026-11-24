// MuPDF exposes types through package exports, while this repo uses legacy Node module resolution.
declare module 'mupdf' {
    export * from 'mupdf/dist/mupdf';
}
