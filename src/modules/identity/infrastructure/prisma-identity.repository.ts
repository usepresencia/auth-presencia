import { randomUUID } from 'node:crypto';
import type { Identity as IdentityRow } from '@prisma/client';
import type { PrismaService } from '../../../shared/infrastructure/persistence/prisma.service';
import type {
    Identity,
    IdentityRepository,
    LinkedIdentity,
    VerifiedFirebaseIdentity,
} from '../domain/identity';

function mapIdentity(row: IdentityRow): Identity {
    return {
        id: row.id,
        status: row.status as Identity['status'],
        email: row.email,
        emailVerified: row.emailVerified,
        createdAt: row.createdAt,
    };
}

export class PrismaIdentityRepository implements IdentityRepository {
    constructor(private readonly prisma: PrismaService) {}

    async findById(id: string): Promise<LinkedIdentity | null> {
        const row = await this.prisma.identity.findUnique({
            where: { id },
            include: { firebaseLinks: { orderBy: { createdAt: 'asc' }, take: 1 } },
        });
        const link = row?.firebaseLinks[0];
        if (!row || !link) return null;
        return { ...mapIdentity(row), projectId: link.firebaseProjectId, uid: link.firebaseUid };
    }

    async findOrCreate(principal: VerifiedFirebaseIdentity): Promise<Identity> {
        const key = {
            firebaseProjectId: principal.projectId,
            firebaseUid: principal.uid,
        };
        return this.prisma.$transaction(
            async tx => {
                // A lock for this external key prevents orphan identities under concurrent first login.
                await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([principal.projectId, principal.uid])}, 0))`;
                const existing = await tx.firebaseIdentity.findUnique({
                    where: { firebaseProjectId_firebaseUid: key },
                    include: { identity: true },
                });
                if (existing) return mapIdentity(existing.identity);
                const created = await tx.identity.create({
                    data: {
                        id: randomUUID(),
                        email: principal.email ?? null,
                        emailVerified: principal.emailVerified,
                        firebaseLinks: { create: key },
                    },
                });
                return mapIdentity(created);
            },
            // Logins simultâneos da mesma conta esperam a lock em vez de falhar.
            { maxWait: 10000, timeout: 15000 },
        );
    }
}
