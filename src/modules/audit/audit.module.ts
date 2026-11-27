import { Module } from '@nestjs/common';
import { PrismaService } from '../persistence/infrastructure/prisma.service';
import { PersistenceModule } from '../persistence/persistence.module';
import { AuditService } from './application/audit.service';
import { PrismaAuditRepository } from './infrastructure/prisma-audit.repository';

@Module({
    imports: [PersistenceModule],
    providers: [
        {
            provide: AuditService,
            useFactory: (prisma: PrismaService) =>
                new AuditService(new PrismaAuditRepository(prisma)),
            inject: [PrismaService],
        },
    ],
    exports: [AuditService],
})
export class AuditModule {}
