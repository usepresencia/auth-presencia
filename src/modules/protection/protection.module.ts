import { Module } from '@nestjs/common';
import { PrismaService } from '../persistence/infrastructure/prisma.service';
import { PersistenceModule } from '../persistence/persistence.module';
import { RateLimiterService } from './application/rate-limiter.service';
import { PrismaRateLimitStore } from './infrastructure/prisma-rate-limit.store';

@Module({
    imports: [PersistenceModule],
    providers: [
        {
            provide: RateLimiterService,
            useFactory: (prisma: PrismaService) =>
                new RateLimiterService(new PrismaRateLimitStore(prisma)),
            inject: [PrismaService],
        },
    ],
    exports: [RateLimiterService],
})
export class ProtectionModule {}
