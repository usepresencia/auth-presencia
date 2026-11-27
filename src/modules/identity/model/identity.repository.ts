import type { Identity, LinkedIdentity, VerifiedFirebaseIdentity } from './identity';

export interface IdentityRepository {
    findById(id: string): Promise<LinkedIdentity | null>;
    findOrCreate(principal: VerifiedFirebaseIdentity): Promise<Identity>;
}
