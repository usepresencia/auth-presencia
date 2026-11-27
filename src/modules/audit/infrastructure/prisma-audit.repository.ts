import type { PrismaService } from '../../persistence/infrastructure/prisma.service';
import type { AuditRepository, StoredAuditEvent } from '../model/audit-event';

const CLEANUP_BATCH = 100;

export class PrismaAuditRepository implements AuditRepository {
    constructor(private readonly prisma: PrismaService) {}

    async save(event: StoredAuditEvent): Promise<void> {
        await this.prisma.auditEvent.create({ data: event });
    }

    async removeBefore(cutoff: Date): Promise<void> {
        const old = await this.prisma.auditEvent.findMany({
            where: { occurredAt: { lt: cutoff } },
            select: { id: true },
            take: CLEANUP_BATCH,
        });
        if (old.length === 0) return;
        await this.prisma.auditEvent.deleteMany({
            where: { id: { in: old.map(row => row.id) } },
        });
    }
}
