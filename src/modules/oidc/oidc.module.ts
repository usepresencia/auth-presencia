import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../shared/config/environment';
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
                    {
                        AUTH_ISSUER: config.get('AUTH_ISSUER', { infer: true }),
                        AUTH_JWKS: config.get('AUTH_JWKS', { infer: true }),
                        AUTH_COOKIE_KEYS: config.get('AUTH_COOKIE_KEYS', { infer: true }),
                        AUTH_CLIENTS: config.get('AUTH_CLIENTS', { infer: true }),
                        AUTH_TRUST_PROXY: config.get('AUTH_TRUST_PROXY', { infer: true }),
                    },
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
