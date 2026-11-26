export type SignInFailure =
    'INVALID_CREDENTIALS' | 'ACCOUNT_DISABLED' | 'TOO_MANY_ATTEMPTS' | 'MFA_UNSUPPORTED';

export class SignInError extends Error {
    constructor(readonly code: SignInFailure) {
        super(code);
        this.name = 'SignInError';
    }
}
