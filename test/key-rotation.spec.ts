import { describe, expect, it } from 'vitest';
import { rotate } from '../scripts/key-rotation.mjs';
import { validateEnvironment } from '../src/shared/config/environment';

const env = () => ({
    AUTH_JWKS: process.env['AUTH_JWKS']!,
    AUTH_COOKIE_KEYS: process.env['AUTH_COOKIE_KEYS']!,
});
const kids = (jwks: string) =>
    (JSON.parse(jwks) as { keys: { kid: string }[] }).keys.map(key => key.kid);
const cookies = (value: string) => value.split(',');

describe('key rotation steps', () => {
    it('adds new keys after the current ones, which keep signing', () => {
        const next = rotate('add', env());
        expect(kids(next.AUTH_JWKS)[0]).toBe('test-key');
        expect(kids(next.AUTH_JWKS)).toHaveLength(2);
        expect(cookies(next.AUTH_COOKIE_KEYS)[0]).toBe(env().AUTH_COOKIE_KEYS);
        expect(cookies(next.AUTH_COOKIE_KEYS)).toHaveLength(2);
        expect(() => validateEnvironment({ ...process.env, ...next })).not.toThrow();
    });

    it('promotes the newest keys to sign', () => {
        const added = rotate('add', env());
        const next = rotate('promote', added);
        expect(kids(next.AUTH_JWKS)).toEqual(kids(added.AUTH_JWKS).reverse());
        expect(cookies(next.AUTH_COOKIE_KEYS)).toEqual(cookies(added.AUTH_COOKIE_KEYS).reverse());
    });

    it('retires every key but the signing one', () => {
        const promoted = rotate('promote', rotate('add', env()));
        const next = rotate('retire', promoted);
        expect(kids(next.AUTH_JWKS)).toEqual([kids(promoted.AUTH_JWKS)[0]]);
        expect(cookies(next.AUTH_COOKIE_KEYS)).toEqual([cookies(promoted.AUTH_COOKIE_KEYS)[0]]);
    });

    it('replaces compromised keys at once', () => {
        const next = rotate('replace', env());
        expect(kids(next.AUTH_JWKS)).toHaveLength(1);
        expect(kids(next.AUTH_JWKS)).not.toContain('test-key');
        expect(next.AUTH_COOKIE_KEYS).not.toBe(env().AUTH_COOKIE_KEYS);
    });

    it.each(['unknown', ''])('rejects the step "%s"', step => {
        expect(() => rotate(step, env())).toThrow(/add, promote, retire ou replace/);
    });

    it('fails without echoing an invalid key set', () => {
        const broken = { ...env(), AUTH_JWKS: 'sensitive-not-json' };
        expect(() => rotate('add', broken)).toThrow(/AUTH_JWKS/);
        expect(() => rotate('add', broken)).not.toThrow(/sensitive/);
    });
});

describe('key configuration', () => {
    const rejects = (change: Record<string, string>, name: RegExp) =>
        expect(() => validateEnvironment({ ...process.env, ...change })).toThrow(name);

    it('rejects two signing keys with the same kid', () => {
        const key = (JSON.parse(env().AUTH_JWKS) as { keys: unknown[] }).keys[0];
        rejects({ AUTH_JWKS: JSON.stringify({ keys: [key, key] }) }, /kid repetido/);
    });

    it('rejects a repeated cookie key', () => {
        const key = env().AUTH_COOKIE_KEYS;
        rejects({ AUTH_COOKIE_KEYS: key + ',' + key }, /AUTH_COOKIE_KEYS/);
    });
});
