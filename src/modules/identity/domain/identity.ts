export interface Identity {
    id: string;
    status: 'active' | 'disabled';
    email: string | null;
    emailVerified: boolean;
    createdAt: Date;
}

/** Internal contract: values must originate from a trusted Firebase verifier. */
export interface VerifiedFirebaseIdentity {
    projectId: string;
    uid: string;
    email?: string;
    emailVerified: boolean;
}

export interface IdentityRepository {
    findOrCreate(principal: VerifiedFirebaseIdentity): Promise<Identity>;
}

export class IdentityDisabledError extends Error {
    constructor() {
        super('Identity is disabled.');
        this.name = 'IdentityDisabledError';
    }
}
