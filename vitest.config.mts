import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        include: ['test/**/*.spec.ts'],
        coverage: {
            provider: 'v8',
            include: ['src/**/*.ts'],
            exclude: ['src/main.ts', 'src/**/*.module.ts'],
            reporter: ['text', 'lcov'],
        },
        env: {
            NODE_ENV: 'test',
            AUTH_ISSUER: 'http://localhost:3340',
        },
    },
});
