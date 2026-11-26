import type { VerifiedFirebaseIdentity } from '../identity/domain/identity';

export const FIREBASE_GATEWAY = Symbol.for('auth-presencia.firebase-gateway');

export interface FirebaseUser {
    uid: string;
    email?: string;
    emailVerified: boolean;
    name?: string;
    disabled: boolean;
    validSince: number;
    customClaims: Record<string, unknown>;
}

export type SignInFailure =
    'INVALID_CREDENTIALS' | 'ACCOUNT_DISABLED' | 'TOO_MANY_ATTEMPTS' | 'MFA_UNSUPPORTED';

export class SignInError extends Error {
    constructor(readonly code: SignInFailure) {
        super(code);
        this.name = 'SignInError';
    }
}

export interface FirebaseGateway {
    getUser(uid: string): Promise<FirebaseUser | null>;
    signIn(email: string, password: string): Promise<VerifiedFirebaseIdentity>;
    sendPasswordReset(email: string): Promise<void>;
}
