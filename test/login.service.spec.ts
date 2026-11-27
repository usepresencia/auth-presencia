import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SignInError } from '../src/modules/accounts/model/sign-in.error';
import type { AuditEvent } from '../src/modules/audit/model/audit-event';
import { LoginService } from '../src/modules/oidc/application/login.service';

const origin = {
    interactionUid: 'interaction',
    clientId: 'web-kontal',
    correlationId: 'fixture-correlation',
    address: '203.0.113.10',
};

function setup({ signIn = () => Promise.resolve('sub-1') } = {}) {
    const limiter = {
        consume: vi.fn(() => Promise.resolve()),
        refund: vi.fn(() => Promise.resolve()),
        clear: vi.fn(() => Promise.resolve()),
        blockedFor: vi.fn(() => Promise.resolve(0)),
    };
    const events: AuditEvent[] = [];
    const service = new LoginService(
        { signIn, sendPasswordReset: () => Promise.resolve() },
        limiter as never,
        { record: (event: AuditEvent) => Promise.resolve(void events.push(event)) } as never,
    );
    const login = () => service.signIn('a@example.test', 'password', origin);
    return { limiter, events, login };
}
const broken = () => Promise.reject(new TypeError('sensitive-detail'));

describe('login with a failing attempt counter', () => {
    afterEach(() => vi.restoreAllMocks());

    for (const operation of ['clear', 'refund'] as const) {
        it('keeps a correct login when ' + operation + ' fails', async () => {
            vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);
            const { limiter, events, login } = setup();
            limiter[operation].mockImplementation(broken);
            await expect(login()).resolves.toBe('sub-1');
            expect(limiter.clear).toHaveBeenCalledTimes(1);
            expect(limiter.refund).toHaveBeenCalledTimes(1);
            expect(events.map(event => event.type)).toEqual(['login_succeeded']);
        });
    }

    it('logs only the error name', async () => {
        const warn = vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);
        const { limiter, login } = setup();
        limiter.clear.mockImplementation(broken);
        await login();
        expect(warn).toHaveBeenCalledOnce();
        expect(String(warn.mock.calls[0])).toContain('TypeError');
        expect(String(warn.mock.calls[0])).not.toContain('sensitive-detail');
    });

    it('keeps the original failure when the refund also fails', async () => {
        vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);
        const outage = new Error('firebase unavailable');
        const { limiter, events, login } = setup({ signIn: () => Promise.reject(outage) });
        limiter.refund.mockImplementation(broken);
        await expect(login()).rejects.toBe(outage);
        expect(events[0]).toMatchObject({ type: 'login_failed', reason: 'AUTH_UNAVAILABLE' });
    });

    it('does not refund a refused password', async () => {
        const refusal = new SignInError('INVALID_CREDENTIALS');
        const { limiter, login } = setup({ signIn: () => Promise.reject(refusal) });
        await expect(login()).rejects.toBe(refusal);
        expect(limiter.refund).not.toHaveBeenCalled();
        expect(limiter.clear).not.toHaveBeenCalled();
    });

    it('still refuses to test the password when the attempt cannot be counted', async () => {
        const signIn = vi.fn(() => Promise.resolve('sub-1'));
        const { limiter, login } = setup({ signIn });
        limiter.consume.mockImplementation(broken);
        await expect(login()).rejects.toThrow(TypeError);
        expect(signIn).not.toHaveBeenCalled();
    });
});
