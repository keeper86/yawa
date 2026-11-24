const createNextIntlPlugin = require('next-intl/plugin');
const nextRoutes = require('nextjs-routes/config');
const withRoutes = nextRoutes();
const withNextIntl = createNextIntlPlugin();

/** @type {import('next').NextConfig} */
const nextConfig = {
    output: 'standalone',
    serverExternalPackages: ['knex', 'pino', 'pino-pretty', '@nalinor/mupdf4llm', 'mupdf', 'tesseract.js'],
    // Workers and WASM are loaded at runtime and can be missed by standalone output tracing.
    outputFileTracingIncludes: {
        '/*': [
            './node_modules/mupdf/dist/**/*',
            './node_modules/tesseract.js/src/**/*',
            './node_modules/tesseract.js-core/**/*',
            './node_modules/@tesseract.js-data/deu/4.0.0_best_int/*',
            './node_modules/@tesseract.js-data/eng/4.0.0_best_int/*',
        ],
    },
    reactStrictMode: true,
    trailingSlash: false,
    typescript: {
        tsconfigPath: 'tsconfig.build.json',
    },
};

module.exports = withRoutes(withNextIntl(nextConfig));
