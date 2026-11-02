import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../config/environment';
import { DatabaseConnection } from './database';

@Module({
    providers: [
        {
            provide: DatabaseConnection,
            useFactory: (config: ConfigService<Environment, true>) =>
                new DatabaseConnection(config.get('DATABASE_URL', { infer: true })),
            inject: [ConfigService],
        },
    ],
    exports: [DatabaseConnection],
})
export class DatabaseModule {}
