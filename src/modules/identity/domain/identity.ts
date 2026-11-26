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

/** Identidade com o vínculo Firebase usado para consultar a conta de origem. */
export interface LinkedIdentity extends Identity {
    projectId: string;
    uid: string;
}

export interface IdentityRepository {
    findById(id: string): Promise<LinkedIdentity | null>;
    findOrCreate(principal: VerifiedFirebaseIdentity): Promise<Identity>;
}

export class IdentityDisabledError extends Error {
    constructor() {
        super('Identity is disabled.');
        this.name = 'IdentityDisabledError';
    }
}
