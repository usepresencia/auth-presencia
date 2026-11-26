export const FIREBASE_GATEWAY = Symbol('FIREBASE_GATEWAY');

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

/** Fronteira com o Firebase. `null` significa usuário inexistente; falhas são propagadas. */
export interface FirebaseGateway {
    getUser(uid: string): Promise<FirebaseUser | null>;
}
