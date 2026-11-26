import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../shared/config/environment';
import { IdentityService } from '../identity/application/identity.service';
import { IdentityModule } from '../identity/identity.module';
import { AccountService } from './account.service';
import { FirebaseAdminGateway } from './firebase-admin.gateway';
import { FIREBASE_GATEWAY, type FirebaseGateway } from './firebase.gateway';

@Module({
    imports: [IdentityModule],
    providers: [
        {
            provide: FIREBASE_GATEWAY,
            useFactory: (config: ConfigService<Environment, true>) =>
                new FirebaseAdminGateway({
                    FIREBASE_PROJECT_ID: config.get('FIREBASE_PROJECT_ID', { infer: true }),
                    FIREBASE_API_KEY: config.get('FIREBASE_API_KEY', { infer: true }),
                    FIREBASE_CLIENT_EMAIL: config.get('FIREBASE_CLIENT_EMAIL', { infer: true }),
                    FIREBASE_PRIVATE_KEY: config.get('FIREBASE_PRIVATE_KEY', { infer: true }),
                    FIREBASE_AUTH_EMULATOR_HOST: config.get('FIREBASE_AUTH_EMULATOR_HOST', {
                        infer: true,
                    }),
                }),
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
    exports: [AccountService, FIREBASE_GATEWAY, IdentityModule],
})
export class AccountsModule {}
