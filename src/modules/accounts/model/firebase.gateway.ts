import type { VerifiedFirebaseIdentity } from '../../identity/model/identity';

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

export interface FirebaseGateway {
    getUser(uid: string): Promise<FirebaseUser | null>;
    signIn(email: string, password: string): Promise<VerifiedFirebaseIdentity>;
    sendPasswordReset(email: string): Promise<void>;
    /** @returns o e-mail da conta cuja senha foi gravada. */
    definePassword(code: string, password: string): Promise<string>;
}
