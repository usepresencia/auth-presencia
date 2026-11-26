import { describe, expect, it, vi } from 'vitest';
import { IdentityService } from '../src/modules/identity/application/identity.service';
import { IdentityDisabledError, type Identity } from '../src/modules/identity/domain/identity';
import { PrismaService } from '../src/shared/infrastructure/persistence/prisma.service';

const principal = { projectId: 'demo-presencia', uid: 'fixture-user', emailVerified: false };

describe('identity trust boundary', () => {
    it('rejects injected privilege fields before persistence', async () => {
        const findOrCreate = vi.fn();
        const service = new IdentityService({ findOrCreate });
        await expect(
            service.resolveVerifiedFirebaseIdentity({
                ...principal,
                platformRole: 'INTERNAL_ADMIN',
            } as typeof principal),
        ).rejects.toThrow();
        expect(findOrCreate).not.toHaveBeenCalled();
    });

    it('refuses a persisted disabled identity', async () => {
        const identity: Identity = {
            id: 'fixture',
            status: 'disabled',
            email: null,
            emailVerified: false,
            createdAt: new Date(),
        };
        const service = new IdentityService({ findOrCreate: async () => identity });
        await expect(service.resolveVerifiedFirebaseIdentity(principal)).rejects.toBeInstanceOf(
            IdentityDisabledError,
        );
    });

    it('does not fall back to memory when the database is missing', () => {
        const config = { get: () => undefined } as unknown as ConstructorParameters<
            typeof PrismaService
        >[0];
        expect(() => new PrismaService(config)).toThrow('DATABASE_URL');
    });
});
