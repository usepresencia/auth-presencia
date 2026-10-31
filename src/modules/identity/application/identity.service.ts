import { z } from 'zod';
import {
    IdentityDisabledError,
    type Identity,
    type IdentityRepository,
    type VerifiedFirebaseIdentity,
} from '../domain/identity';

const principalSchema = z
    .object({
        projectId: z
            .string()
            .min(1)
            .max(128)
            .regex(/^[a-z0-9][a-z0-9-]*$/),
        uid: z
            .string()
            .min(1)
            .max(128)
            .refine(
                value =>
                    [...value].every(
                        character =>
                            character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
                    ),
                'UID contains control characters.',
            ),
        email: z.email().max(320).optional(),
        emailVerified: z.boolean(),
    })
    .strict();

/** Resolves a verified external principal; does not authenticate tokens or grant product access. */
export class IdentityService {
    constructor(private readonly repository: IdentityRepository) {}

    async resolveVerifiedFirebaseIdentity(principal: VerifiedFirebaseIdentity): Promise<Identity> {
        const validated = principalSchema.parse(principal);
        const identity = await this.repository.findOrCreate(validated);
        if (identity.status !== 'active') throw new IdentityDisabledError();
        return identity;
    }
}
