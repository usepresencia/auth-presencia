export type SignInFailure =
    | 'INVALID_CREDENTIALS'
    | 'ACCOUNT_DISABLED'
    | 'TOO_MANY_ATTEMPTS'
    | 'MFA_UNSUPPORTED'
    | 'PASSWORD_CODE_INVALID'
    | 'WEAK_PASSWORD';

export class SignInError extends Error {
    constructor(readonly code: SignInFailure) {
        super(code);
        this.name = 'SignInError';
    }
}
