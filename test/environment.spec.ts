import { describe, expect, it } from 'vitest';
import { validateEnvironment } from '../src/shared/config/environment';

const valid: Record<string, string> = Object.fromEntries(
    [
        'AUTH_ISSUER',
        'DATABASE_URL',
        'AUTH_JWKS',
        'AUTH_COOKIE_KEYS',
        'AUTH_CLIENTS',
        'FIREBASE_PROJECT_ID',
        'FIREBASE_API_KEY',
    ].map(name => [name, process.env[name] as string]),
);
const production = {
    ...valid,
    NODE_ENV: 'production',
    AUTH_ISSUER: 'https://auth.presencia.com.br',
    FIREBASE_PROJECT_ID: 'presencia-prod',
    AUTH_TRUST_PROXY: 'true',
};
const client = () => JSON.parse(valid['AUTH_CLIENTS'])[0] as Record<string, unknown>;
const rejects = (change: Record<string, unknown>, name: string, base = valid) =>
    expect(() => validateEnvironment({ ...base, ...change })).toThrow(name);

describe('environment validation', () => {
    it('parses keys, clients and flags into typed values', () => {
        const env = validateEnvironment(valid);
        expect(env.AUTH_JWKS.keys[0]?.kid).toBe('test-key');
        expect(env.AUTH_COOKIE_KEYS).toHaveLength(1);
        expect(env.AUTH_CLIENTS[0]?.audience).toBe('api-kontal');
        expect(env.AUTH_TRUST_PROXY).toBe(false);
        expect(validateEnvironment({ ...valid, AUTH_TRUST_PROXY: 'true' }).AUTH_TRUST_PROXY).toBe(
            true,
        );
    });

    it('rejects a non-PostgreSQL database URL without leaking its credentials', () => {
        let message = '';
        try {
            validateEnvironment({
                ...valid,
                DATABASE_URL: 'https://fixture:sensitive@example.test/db',
            });
        } catch (error) {
            message = (error as Error).message;
        }
        expect(message).toContain('DATABASE_URL');
        expect(message).not.toContain('sensitive');
    });

    it.each([
        'DATABASE_URL',
        'AUTH_JWKS',
        'AUTH_COOKIE_KEYS',
        'AUTH_CLIENTS',
        'FIREBASE_PROJECT_ID',
        'FIREBASE_API_KEY',
    ])('requires %s', name => rejects({ [name]: undefined }, name));

    it('rejects a public-only signing key', () => {
        const publicKey = { ...JSON.parse(valid['AUTH_JWKS']).keys[0], d: undefined };
        rejects({ AUTH_JWKS: JSON.stringify({ keys: [publicKey] }) }, 'AUTH_JWKS');
    });

    it('rejects a cookie key shorter than 32 characters', () =>
        rejects({ AUTH_COOKIE_KEYS: 'a'.repeat(31) }, 'AUTH_COOKIE_KEYS'));

    it.each([
        ['a short client secret', { clientSecret: 'a'.repeat(31) }],
        ['a non-loopback http redirect', { redirectUris: ['http://kontal.example.test/cb'] }],
        ['a redirect with fragment', { redirectUris: ['https://kontal.example.test/cb#x'] }],
        ['an http post logout redirect', { postLogoutRedirectUris: ['http://example.test'] }],
        ['an unknown property', { extra: true }],
    ])('rejects a client with %s', (_name, change) =>
        rejects({ AUTH_CLIENTS: JSON.stringify([{ ...client(), ...change }]) }, 'AUTH_CLIENTS'),
    );

    it('rejects duplicated client ids', () =>
        rejects({ AUTH_CLIENTS: JSON.stringify([client(), client()]) }, 'AUTH_CLIENTS'));

    it.each(['AUTH_JWKS', 'AUTH_CLIENTS'])('never echoes %s content in the error', name => {
        let message = '';
        try {
            validateEnvironment({ ...valid, [name]: 'sensitive-not-json' });
        } catch (error) {
            message = (error as Error).message;
        }
        expect(message).toContain(name);
        expect(message).not.toContain('sensitive');
    });

    it('rejects the Firestore emulator in production', () =>
        rejects(
            { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' },
            'FIRESTORE_EMULATOR_HOST',
            production,
        ));

    it('accepts the emulator host outside production', () => {
        expect(
            validateEnvironment({ ...valid, FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' })
                .FIREBASE_AUTH_EMULATOR_HOST,
        ).toBe('127.0.0.1:9099');
    });

    it('rejects the emulator host in production', () =>
        rejects(
            { FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' },
            'FIREBASE_AUTH_EMULATOR_HOST',
            production,
        ));

    it.each(['http://127.0.0.1:9099', '127.0.0.1', 'host:9099/path'])(
        'rejects emulator host %s',
        host => rejects({ FIREBASE_AUTH_EMULATOR_HOST: host }, 'FIREBASE_AUTH_EMULATOR_HOST'),
    );

    it.each([undefined, 'false'])(
        'requires a trusted proxy in production so cookies are Secure (%s)',
        value => rejects({ AUTH_TRUST_PROXY: value }, 'AUTH_TRUST_PROXY', production),
    );

    it('rejects a demo- project id in production', () =>
        rejects({ FIREBASE_PROJECT_ID: 'demo-presencia' }, 'FIREBASE_PROJECT_ID', production));

    it('accepts the local issuer and applies typed defaults', () => {
        expect(validateEnvironment(valid)).toMatchObject({
            NODE_ENV: 'development',
            HOST: '127.0.0.1',
            PORT: 3340,
        });
    });

    it('requires an explicit issuer', () => {
        rejects({ AUTH_ISSUER: undefined }, 'AUTH_ISSUER');
    });

    it.each(['0', '65536', 'NaN', '3340.5'])('rejects invalid port %s', PORT => {
        expect(() => validateEnvironment({ ...valid, PORT })).toThrow('PORT');
    });

    it.each([
        'http://auth.presencia.com.br',
        'https://user:password@auth.presencia.com.br',
        'https://auth.presencia.com.br/path',
        'https://auth.presencia.com.br?query=1',
        'https://auth.presencia.com.br#fragment',
        'file:///tmp/auth',
    ])('rejects unsafe issuer %s', AUTH_ISSUER => {
        rejects({ AUTH_ISSUER }, 'AUTH_ISSUER');
    });

    it('rejects HTTP in production even on localhost', () => {
        expect(() =>
            validateEnvironment({ ...production, AUTH_ISSUER: 'http://localhost:3340' }),
        ).toThrow('HTTPS');
    });

    it('accepts a production HTTPS issuer', () => {
        expect(validateEnvironment({ ...production, PORT: '3340' }).PORT).toBe(3340);
    });
});
