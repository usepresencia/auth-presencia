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
import { LoginService } from './application/login.service';
import { createPrismaAdapter } from './infrastructure/prisma-oidc.adapter';
import { LogoutController } from './presentation/logout.controller';
import { createProvider } from './infrastructure/provider/provider.factory';
import { createSessionExtension } from './infrastructure/prisma-session.extension';

@Module({
    imports: [PersistenceModule, AccountsModule],
    controllers: [InteractionController, LogoutController],
    providers: [
        {
            provide: LoginService,
            useFactory: (accounts: AccountService) => new LoginService(accounts),
            inject: [AccountService],
        },
        {
            provide: OIDC_PROVIDER,
            useFactory: (
                config: ConfigService<Environment, true>,
                prisma: PrismaService,
                accounts: AccountService,
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
                    createSessionExtension(prisma),
                ),
            inject: [ConfigService, PrismaService, AccountService],
        },
    ],
    exports: [OIDC_PROVIDER],
})
export class OidcModule {}
