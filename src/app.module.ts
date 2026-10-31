import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AccessModule } from './modules/access/access.module';
import { AuditModule } from './modules/audit/audit.module';
import { HealthModule } from './modules/health/health.module';
import { IdentityModule } from './modules/identity/identity.module';
import { ManagementModule } from './modules/management/management.module';
import { OidcModule } from './modules/oidc/oidc.module';
import { validateEnvironment } from './shared/config/environment';

@Module({
    imports: [
        ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment }),
        HealthModule,
        IdentityModule,
        AccessModule,
        OidcModule,
        ManagementModule,
        AuditModule,
    ],
})
export class AppModule {}
