import { Module } from '@nestjs/common';
import { PrismaModule } from '../../shared/infrastructure/persistence/prisma.module';
import { PrismaService } from '../../shared/infrastructure/persistence/prisma.service';
import { IdentityService } from './application/identity.service';
import { PrismaIdentityRepository } from './infrastructure/prisma-identity.repository';

@Module({
    imports: [PrismaModule],
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
