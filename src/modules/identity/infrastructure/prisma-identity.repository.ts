import { randomUUID } from 'node:crypto';
import type { Identity as IdentityRow } from '@prisma/client';
import type { PrismaService } from '../../persistence/infrastructure/prisma.service';
import type { Identity, LinkedIdentity, VerifiedFirebaseIdentity } from '../model/identity';
import type { IdentityRepository } from '../model/identity.repository';

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

    /**
     * Devolve a identidade do vínculo Firebase, criando-a no primeiro login. Chamadas
     * concorrentes para o mesmo vínculo produzem uma única identidade.
     */
    async findOrCreate(principal: VerifiedFirebaseIdentity): Promise<Identity> {
        const key = {
            firebaseProjectId: principal.projectId,
            firebaseUid: principal.uid,
        };
        return this.prisma.$transaction(
            async tx => {
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
            { maxWait: 10000, timeout: 15000 },
        );
    }
}
