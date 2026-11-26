import { describe, expect, it, vi } from 'vitest';
import { FirebaseAdminGateway } from '../src/modules/accounts/infrastructure/firebase-admin.gateway';
import { SignInError } from '../src/modules/accounts/model/sign-in.error';

const password = 'fixture-password-sensitive';
const apiKey = 'fixture-api-key-sensitive';
const decoded = { uid: 'fb-1', email: 'person@example.test', email_verified: true };

function gateway(status: number, body: unknown, verify = vi.fn(async () => decoded)) {
    const request = vi.fn(async () => new Response(JSON.stringify(body), { status }));
    const instance = new FirebaseAdminGateway(
        { FIREBASE_PROJECT_ID: 'demo-presencia', FIREBASE_API_KEY: apiKey },
        { fetch: request as unknown as typeof fetch, verifyIdToken: verify },
    );
    return { instance, request, verify };
}
const failure = (message: string) => gateway(400, { error: { message } }).instance;
const failureOf = (promise: Promise<unknown>) =>
    promise.then(
        () => undefined,
        error => error as Error & { code?: string },
    );

describe('Firebase password sign-in', () => {
    it.each([
        ['INVALID_LOGIN_CREDENTIALS', 'INVALID_CREDENTIALS'],
        ['EMAIL_NOT_FOUND', 'INVALID_CREDENTIALS'],
        ['INVALID_PASSWORD', 'INVALID_CREDENTIALS'],
        ['INVALID_EMAIL', 'INVALID_CREDENTIALS'],
        ['USER_DISABLED', 'ACCOUNT_DISABLED'],
        ['TOO_MANY_ATTEMPTS_TRY_LATER : try again', 'TOO_MANY_ATTEMPTS'],
    ])('maps %s to %s', async (message, code) => {
        const error = await failureOf(failure(message).signIn('a@example.test', password));
        expect(error).toBeInstanceOf(SignInError);
        expect(error?.code).toBe(code);
    });

    it('reports MFA_UNSUPPORTED when the response carries mfaPendingCredential', async () => {
        const { instance, verify } = gateway(200, { mfaPendingCredential: 'pending' });
        const error = await failureOf(instance.signIn('a@example.test', password));
        expect(error?.code).toBe('MFA_UNSUPPORTED');
        expect(verify).not.toHaveBeenCalled();
    });

    it('verifies the returned ID token with revocation check', async () => {
        const { instance, verify, request } = gateway(200, { idToken: 'id-token' });
        await expect(instance.signIn('a@example.test', password)).resolves.toEqual({
            projectId: 'demo-presencia',
            uid: 'fb-1',
            email: 'person@example.test',
            emailVerified: true,
        });
        expect(verify).toHaveBeenCalledWith('id-token', true);
        expect(request).toHaveBeenCalledTimes(1);
    });

    it('maps a disabled user detected during token verification', async () => {
        const verify = vi.fn(async () => {
            throw Object.assign(new Error('disabled'), { code: 'auth/user-disabled' });
        });
        const { instance } = gateway(200, { idToken: 'id-token' }, verify);
        const error = await failureOf(instance.signIn('a@example.test', password));
        expect(error?.code).toBe('ACCOUNT_DISABLED');
    });

    it('swallows EMAIL_NOT_FOUND on password reset', async () => {
        await expect(
            failure('EMAIL_NOT_FOUND').sendPasswordReset('a@example.test'),
        ).resolves.toBeUndefined();
    });

    it('reports throttling on password reset', async () => {
        const error = await failureOf(
            failure('TOO_MANY_ATTEMPTS_TRY_LATER').sendPasswordReset('a@example.test'),
        );
        expect(error?.code).toBe('TOO_MANY_ATTEMPTS');
    });

    it('never includes the password or API key in a thrown error', async () => {
        const network = new FirebaseAdminGateway(
            { FIREBASE_PROJECT_ID: 'demo-presencia', FIREBASE_API_KEY: apiKey },
            {
                fetch: async url => {
                    throw new Error('failed ' + String(url) + ' ' + password);
                },
            },
        );
        for (const promise of [
            network.signIn('a@example.test', password),
            failure('SOMETHING_NEW').signIn('a@example.test', password),
            failure('SOMETHING_NEW').sendPasswordReset('a@example.test'),
        ]) {
            const error = await failureOf(promise);
            expect(error).toBeDefined();
            expect(error).not.toBeInstanceOf(SignInError);
            const text = String(error?.stack) + JSON.stringify(error) + String(error?.cause);
            expect(text).not.toContain(password);
            expect(text).not.toContain(apiKey);
        }
    });
});
