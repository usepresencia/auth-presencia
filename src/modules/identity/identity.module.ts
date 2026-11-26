import { Module } from '@nestjs/common';
import { PersistenceModule } from '../persistence/persistence.module';
import { PrismaService } from '../persistence/infrastructure/prisma.service';
import { IdentityService } from './application/identity.service';
import { PrismaIdentityRepository } from './infrastructure/prisma-identity.repository';

@Module({
    imports: [PersistenceModule],
    providers: [
        {
            provide: IdentityService,
            useFactory: (prisma: PrismaService) =>
                new IdentityService(new PrismaIdentityRepository(prisma)),
            inject: [PrismaService],
        },
    ],
    exports: [IdentityService],
})
export class IdentityModule {}
