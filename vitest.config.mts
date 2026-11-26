import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { defineConfig } from 'vitest/config';

// Fixtures sintéticas, geradas a cada execução: nenhum segredo versionado.
const signingKey = {
    ...generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'jwk' }),
    kid: 'test-key',
    alg: 'RS256',
    use: 'sig',
};
const secret = () => randomBytes(32).toString('base64url');

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
            AUTH_JWKS: JSON.stringify({ keys: [signingKey] }),
            AUTH_COOKIE_KEYS: secret(),
            AUTH_CLIENTS: JSON.stringify([
                {
                    clientId: 'web-kontal',
                    clientSecret: secret(),
                    redirectUris: ['http://localhost:3341/callback'],
                    postLogoutRedirectUris: ['http://localhost:3341'],
                    resource: 'urn:presencia:api-kontal',
                    audience: 'api-kontal',
                    scope: 'api',
                    firebaseClaims: ['platformRole', 'kontalMemberships'],
                },
            ]),
            FIREBASE_PROJECT_ID: 'demo-presencia',
            FIREBASE_API_KEY: 'fake-api-key',
        },
    },
});
