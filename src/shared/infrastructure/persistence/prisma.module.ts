import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../config/environment';
import { PrismaService } from './prisma.service';

@Global()
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
export class PrismaModule {}
