import { describe, expect, it } from 'vitest';
import { absoluteRemaining, sessionTtl } from '../src/modules/oidc/session-policy';

const day = 86400;

describe('session policy', () => {
    it('gives a new session the seven day idle window', () => {
        expect(sessionTtl(0, 0)).toBe(7 * day);
    });

    it('never extends past fourteen days after the login', () => {
        expect(sessionTtl(0, 8 * day)).toBe(6 * day);
        expect(sessionTtl(0, 14 * day)).toBe(0);
        expect(sessionTtl(0, 20 * day)).toBe(0);
    });

    it('measures the absolute lifetime from the login', () => {
        expect(absoluteRemaining(100, 100 + 13 * day)).toBe(day);
        expect(absoluteRemaining(0, 15 * day)).toBe(0);
    });
});
