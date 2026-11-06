import dotenv from 'dotenv';
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

dotenv.config({ override: false, quiet: true });

export default defineConfig({
    plugins: [tsconfigPaths()],
    test: {
        include: ['tests/smoke/**/*.test.ts'],
        environment: 'node',
        testTimeout: 300_000,
    },
});
