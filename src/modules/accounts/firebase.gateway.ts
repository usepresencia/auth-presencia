import type { VerifiedFirebaseIdentity } from '../identity/domain/identity';

export const FIREBASE_GATEWAY = Symbol.for('auth-presencia.firebase-gateway');

export interface FirebaseUser {
    uid: string;
    email?: string;
    emailVerified: boolean;
    name?: string;
    disabled: boolean;
    /** Epoch em segundos da última revogação de credenciais; 0 se nunca houve. */
    validSince: number;
    customClaims: Record<string, unknown>;
}

export type SignInFailure =
    'INVALID_CREDENTIALS' | 'ACCOUNT_DISABLED' | 'TOO_MANY_ATTEMPTS' | 'MFA_UNSUPPORTED';

/** Recusa esperada de login. Qualquer outro erro é indisponibilidade. */
export class SignInError extends Error {
    constructor(readonly code: SignInFailure) {
        super(code);
        this.name = 'SignInError';
    }
}

/** Fronteira com o Firebase. `null` significa usuário inexistente; falhas são propagadas. */
export interface FirebaseGateway {
    getUser(uid: string): Promise<FirebaseUser | null>;
    /** Confere e-mail e senha e devolve a identidade já verificada pelo Admin SDK. */
    signIn(email: string, password: string): Promise<VerifiedFirebaseIdentity>;
    /** Não revela se o e-mail existe. */
    sendPasswordReset(email: string): Promise<void>;
}
