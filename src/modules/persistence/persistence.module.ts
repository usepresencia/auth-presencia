import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../shared/config/environment';
import { PrismaService } from './infrastructure/prisma.service';

@Module({
    providers: [
        {
            provide: PrismaService,
            useFactory: (config: ConfigService<Environment, true>) => new PrismaService(config),
            inject: [ConfigService],
        },
    ],
    exports: [PrismaService],
})
export class PersistenceModule {}
