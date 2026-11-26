import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../shared/config/environment';
import { pickConfig } from '../../shared/config/pick-config';
import { IdentityService } from '../identity/application/identity.service';
import { IdentityModule } from '../identity/identity.module';
import { AccountService } from './application/account.service';
import { FirebaseAdminGateway } from './infrastructure/firebase-admin.gateway';
import { FIREBASE_GATEWAY, type FirebaseGateway } from './model/firebase.gateway';

@Module({
    imports: [IdentityModule],
    providers: [
        {
            provide: FIREBASE_GATEWAY,
            useFactory: (config: ConfigService<Environment, true>) =>
                new FirebaseAdminGateway(
                    pickConfig(
                        config,
                        'FIREBASE_PROJECT_ID',
                        'FIREBASE_API_KEY',
                        'FIREBASE_CLIENT_EMAIL',
                        'FIREBASE_PRIVATE_KEY',
                        'FIREBASE_AUTH_EMULATOR_HOST',
                    ),
                ),
            inject: [ConfigService],
        },
        {
            provide: AccountService,
            useFactory: (
                identities: IdentityService,
                firebase: FirebaseGateway,
                config: ConfigService<Environment, true>,
            ) =>
                new AccountService(
                    identities,
                    firebase,
                    config.get('FIREBASE_PROJECT_ID', { infer: true }),
                ),
            inject: [IdentityService, FIREBASE_GATEWAY, ConfigService],
        },
    ],
    exports: [AccountService],
})
export class AccountsModule {}
