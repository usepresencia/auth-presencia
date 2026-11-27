import { Module } from '@nestjs/common';
import { PrismaService } from '../persistence/infrastructure/prisma.service';
import { PersistenceModule } from '../persistence/persistence.module';
import { ReadinessService } from './application/readiness.service';
import { DatabaseReadinessCheck } from './infrastructure/database-readiness.check';
import { HealthController } from './presentation/health.controller';

@Module({
    imports: [PersistenceModule],
    controllers: [HealthController],
    providers: [
        {
            provide: ReadinessService,
            useFactory: (prisma: PrismaService) =>
                new ReadinessService(new DatabaseReadinessCheck(prisma)),
            inject: [PrismaService],
        },
    ],
})
export class HealthModule {}
