const createNextIntlPlugin = require('next-intl/plugin');
const nextRoutes = require('nextjs-routes/config');
const withRoutes = nextRoutes();
const withNextIntl = createNextIntlPlugin();

/** @type {import('next').NextConfig} */
const nextConfig = {
    output: 'standalone',
    serverExternalPackages: ['knex', 'pino', 'pino-pretty'],
    reactStrictMode: true,
    trailingSlash: false,
};

module.exports = withRoutes(withNextIntl(nextConfig));
