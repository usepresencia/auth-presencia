import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../shared/config/environment';
import { pickConfig } from '../../shared/config/pick-config';
import { PersistenceModule } from '../persistence/persistence.module';
import { PrismaService } from '../persistence/infrastructure/prisma.service';
import { AccountService } from '../accounts/application/account.service';
import { AccountsModule } from '../accounts/accounts.module';
import { InteractionController } from './presentation/interaction.controller';
import { OIDC_PROVIDER } from './oidc.tokens';
import { RecordErrorService } from '../errors/application/record-error.service';
import { ErrorsModule } from '../errors/errors.module';
import { RateLimiterService } from '../protection/application/rate-limiter.service';
import { ProtectionModule } from '../protection/protection.module';
import { AuditService } from '../audit/application/audit.service';
import { AuditModule } from '../audit/audit.module';
import { LoginService } from './application/login.service';
import { createPrismaAdapter } from './infrastructure/prisma-oidc.adapter';
import { LogoutController } from './presentation/logout.controller';
import { createProvider } from './infrastructure/provider/provider.factory';
import { createSessionExtension } from './infrastructure/prisma-session.extension';

@Module({
    imports: [PersistenceModule, AccountsModule, ErrorsModule, ProtectionModule, AuditModule],
    controllers: [InteractionController, LogoutController],
    providers: [
        {
            provide: LoginService,
            useFactory: (
                accounts: AccountService,
                limiter: RateLimiterService,
                audit: AuditService,
            ) => new LoginService(accounts, limiter, audit),
            inject: [AccountService, RateLimiterService, AuditService],
        },
        {
            provide: OIDC_PROVIDER,
            useFactory: (
                config: ConfigService<Environment, true>,
                prisma: PrismaService,
                accounts: AccountService,
                errors: RecordErrorService,
                audit: AuditService,
            ) =>
                createProvider(
                    pickConfig(
                        config,
                        'AUTH_ISSUER',
                        'AUTH_JWKS',
                        'AUTH_COOKIE_KEYS',
                        'AUTH_CLIENTS',
                        'AUTH_TRUST_PROXY',
                    ),
                    createPrismaAdapter(prisma),
                    accounts,
                    {
                        extendSession: createSessionExtension(prisma),
                        reportError: report =>
                            void errors.record({ ...report, code: 'INTERNAL_ERROR' }),
                        audit: event => void audit.record(event),
                    },
                ),
            inject: [
                ConfigService,
                PrismaService,
                AccountService,
                RecordErrorService,
                AuditService,
            ],
        },
    ],
    exports: [OIDC_PROVIDER],
})
export class OidcModule {}
