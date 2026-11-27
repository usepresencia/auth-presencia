import type { PrismaService } from '../../persistence/infrastructure/prisma.service';
import type { ReadinessCheck } from '../model/readiness';

export class DatabaseReadinessCheck implements ReadinessCheck {
    constructor(private readonly prisma: PrismaService) {}

    async verify(): Promise<void> {
        await Promise.all([
            this.prisma.identity.findFirst({ select: { id: true } }),
            this.prisma.firebaseIdentity.findFirst({ select: { identityId: true } }),
            this.prisma.oidcArtifact.findFirst({ select: { id: true } }),
            this.prisma.rateLimit.findFirst({ select: { key: true } }),
            this.prisma.auditEvent.findFirst({ select: { id: true } }),
        ]);
    }
}
