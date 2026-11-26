import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../shared/config/environment';
import { pickConfig } from '../../shared/config/pick-config';
import { PrismaModule } from '../../shared/infrastructure/persistence/prisma.module';
import { PrismaService } from '../../shared/infrastructure/persistence/prisma.service';
import { AccountService } from '../accounts/account.service';
import { AccountsModule } from '../accounts/accounts.module';
import { InteractionController } from './interaction.controller';
import { OIDC_PROVIDER } from './oidc.tokens';
import { createPrismaAdapter } from './prisma.adapter';
import { LogoutController } from './logout.controller';
import { createProvider } from './provider.factory';
import { createSessionExtension } from './session-extension';

export { OIDC_PROVIDER };

@Module({
    imports: [PrismaModule, AccountsModule],
    controllers: [InteractionController, LogoutController],
    providers: [
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
