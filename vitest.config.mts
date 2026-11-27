import { defineConfig } from 'vitest/config';
import { kontalClient, secret, signingKey } from './test/support/fixtures.mjs';

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
            DATABASE_URL: 'postgresql://fixture@127.0.0.1:1/auth_test',
            AUTH_JWKS: JSON.stringify({ keys: [signingKey('test-key')] }),
            AUTH_COOKIE_KEYS: secret(),
            AUTH_CLIENTS: JSON.stringify([
                kontalClient('http://localhost:3341/callback', 'http://localhost:3341'),
            ]),
            FIREBASE_PROJECT_ID: 'demo-presencia',
            FIREBASE_WEB_API_KEY: 'fake-api-key',
        },
    },
});
