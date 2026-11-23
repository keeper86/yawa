import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
    plugins: [react(), tsconfigPaths()],
    test: {
        environment: 'node',
        env: {
            NODE_ENV: 'test',
        },
        projects: [
            {
                extends: true,
                test: {
                    name: 'embedding',
                    include: ['src/server/embedding.test.ts'],
                },
            },
            {
                extends: true,
                test: {
                    name: 'database',
                    include: ['src/server/**/*.test.ts'],
                    exclude: ['src/server/embedding.test.ts'],
                    setupFiles: ['./tests/vitest/setupTestcontainer.ts'],
                },
            },
        ],
        globals: true,
        typecheck: {
            tsconfig: './tsconfig.json',
        },
        exclude: [
            '**/node_modules/**',
            '**/dist/**',
            '**/cypress/**',
            '**/.{idea,git,cache,output,temp}/**',
            '**/tests/e2e/**',
        ],
        hookTimeout: 30000,
        sequence: {
            shuffle: false, // Ensure tests run in a predictable order
            concurrent: false, // Run test files sequentially
        },
    },
});
