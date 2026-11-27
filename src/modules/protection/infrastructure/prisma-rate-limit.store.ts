import type { PrismaService } from '../../persistence/infrastructure/prisma.service';
import {
    STRIKE_MEMORY_SECONDS,
    type RateLimitState,
    type RateLimitStore,
} from '../model/rate-limit';

const CLEANUP_BATCH = 100;

export class PrismaRateLimitStore implements RateLimitStore {
    constructor(private readonly prisma: PrismaService) {}

    async update<T>(
        key: string,
        change: (state: RateLimitState | undefined) => { state: RateLimitState; result: T },
    ): Promise<T> {
        await this.removeStale();
        return this.prisma.$transaction(
            async tx => {
                await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 1))`;
                const row = await tx.rateLimit.findUnique({ where: { key } });
                const { state, result } = change(row ?? undefined);
                const data = {
                    count: state.count,
                    windowStart: state.windowStart,
                    blockedUntil: state.blockedUntil,
                    strikes: state.strikes,
                    updatedAt: state.updatedAt,
                };
                await tx.rateLimit.upsert({
                    where: { key },
                    create: { key, ...data },
                    update: data,
                });
                return result;
            },
            { maxWait: 10000, timeout: 15000 },
        );
    }

    async find(key: string): Promise<RateLimitState | undefined> {
        return (await this.prisma.rateLimit.findUnique({ where: { key } })) ?? undefined;
    }

    async delete(key: string): Promise<void> {
        await this.prisma.rateLimit.deleteMany({ where: { key } });
    }

    private async removeStale(): Promise<void> {
        const cutoff = new Date(Date.now() - STRIKE_MEMORY_SECONDS * 1000);
        const stale = await this.prisma.rateLimit.findMany({
            where: { updatedAt: { lt: cutoff } },
            select: { key: true },
            take: CLEANUP_BATCH,
        });
        if (stale.length === 0) return;
        await this.prisma.rateLimit.deleteMany({
            where: { key: { in: stale.map(row => row.key) }, updatedAt: { lt: cutoff } },
        });
    }
}
