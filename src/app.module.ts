import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ErrorsModule } from './modules/errors/errors.module';
import { HealthModule } from './modules/health/health.module';
import { IdentityModule } from './modules/identity/identity.module';
import { OidcModule } from './modules/oidc/oidc.module';
import { ProtectionModule } from './modules/protection/protection.module';
import { validateEnvironment } from './shared/config/environment';

@Module({
    imports: [
        ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment }),
        ErrorsModule,
        HealthModule,
        IdentityModule,
        ProtectionModule,
        OidcModule,
    ],
})
export class AppModule {}
