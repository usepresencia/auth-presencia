export interface Identity {
    id: string;
    status: 'active' | 'disabled';
    email: string | null;
    emailVerified: boolean;
    createdAt: Date;
}

export interface VerifiedFirebaseIdentity {
    projectId: string;
    uid: string;
    email?: string;
    emailVerified: boolean;
}

export interface LinkedIdentity extends Identity {
    projectId: string;
    uid: string;
}
