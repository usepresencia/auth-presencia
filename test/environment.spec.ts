import { describe, expect, it } from 'vitest';
import { validateEnvironment } from '../src/shared/config/environment';

describe('environment validation', () => {
    it('accepts a PostgreSQL URL without requiring a database for the HTTP foundation', () => {
        expect(
            validateEnvironment({
                AUTH_ISSUER: 'http://localhost:3340',
                DATABASE_URL: 'postgresql://fixture@localhost/auth_test',
            }).DATABASE_URL,
        ).toBeDefined();
    });

    it('rejects a non-PostgreSQL database URL without leaking its credentials', () => {
        let message = '';
        try {
            validateEnvironment({
                AUTH_ISSUER: 'http://localhost:3340',
                DATABASE_URL: 'https://fixture:sensitive@example.test/db',
            });
        } catch (error) {
            message = (error as Error).message;
        }
        expect(message).toContain('DATABASE_URL');
        expect(message).not.toContain('sensitive');
    });

    it('keeps database configuration optional until persistence is provisioned', () => {
        expect(
            validateEnvironment({ AUTH_ISSUER: 'http://localhost:3340' }).DATABASE_URL,
        ).toBeUndefined();
    });

    it('accepts the local issuer and applies typed defaults', () => {
        expect(validateEnvironment({ AUTH_ISSUER: 'http://localhost:3340' })).toMatchObject({
            NODE_ENV: 'development',
            HOST: '127.0.0.1',
            PORT: 3340,
        });
    });

    it('requires an explicit issuer', () => {
        expect(() => validateEnvironment({})).toThrow('AUTH_ISSUER');
    });

    it.each(['0', '65536', 'NaN', '3340.5'])('rejects invalid port %s', PORT => {
        expect(() =>
            validateEnvironment({ AUTH_ISSUER: 'https://auth.presencia.com.br', PORT }),
        ).toThrow('PORT');
    });

    it.each([
        'http://auth.presencia.com.br',
        'https://user:password@auth.presencia.com.br',
        'https://auth.presencia.com.br/path',
        'https://auth.presencia.com.br?query=1',
        'https://auth.presencia.com.br#fragment',
        'file:///tmp/auth',
    ])('rejects unsafe issuer %s', AUTH_ISSUER => {
        expect(() => validateEnvironment({ AUTH_ISSUER })).toThrow('AUTH_ISSUER');
    });

    it('rejects HTTP in production even on localhost', () => {
        expect(() =>
            validateEnvironment({ NODE_ENV: 'production', AUTH_ISSUER: 'http://localhost:3340' }),
        ).toThrow('HTTPS');
    });

    it('accepts a production HTTPS issuer', () => {
        expect(
            validateEnvironment({
                NODE_ENV: 'production',
                AUTH_ISSUER: 'https://auth.presencia.com.br',
                PORT: '3340',
            }).PORT,
        ).toBe(3340);
    });
});
