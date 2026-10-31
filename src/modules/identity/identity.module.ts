import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../shared/infrastructure/persistence/database.module';
import { DatabaseConnection } from '../../shared/infrastructure/persistence/database';
import { IdentityService } from './application/identity.service';
import { PostgresIdentityRepository } from './infrastructure/postgres-identity.repository';

@Module({
    imports: [DatabaseModule],
    providers: [
        {
            provide: IdentityService,
            useFactory: (database: DatabaseConnection) =>
                new IdentityService(new PostgresIdentityRepository(database)),
            inject: [DatabaseConnection],
        },
    ],
    exports: [IdentityService],
})
export class IdentityModule {}
