import { randomUUID } from 'node:crypto';
import type { OnModuleDestroy } from '@nestjs/common';
import { applicationDefault, cert, deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import type { Environment } from '../../shared/config/environment';
import type { FirebaseGateway, FirebaseUser } from './firebase.gateway';

export type FirebaseSettings = Pick<
    Environment,
    | 'FIREBASE_PROJECT_ID'
    | 'FIREBASE_CLIENT_EMAIL'
    | 'FIREBASE_PRIVATE_KEY'
    | 'FIREBASE_AUTH_EMULATOR_HOST'
>;

export class FirebaseAdminGateway implements FirebaseGateway, OnModuleDestroy {
    private readonly app: App;
    private readonly auth: Auth;

    constructor(settings: FirebaseSettings) {
        const projectId = settings.FIREBASE_PROJECT_ID;
        // O Admin SDK lê o host do emulador do ambiente; com ele, não há credencial.
        const emulator =
            settings.FIREBASE_AUTH_EMULATOR_HOST ?? process.env.FIREBASE_AUTH_EMULATOR_HOST;
        const clientEmail = settings.FIREBASE_CLIENT_EMAIL;
        const privateKey = settings.FIREBASE_PRIVATE_KEY?.replaceAll('\\n', '\n');
        const credential = emulator
            ? undefined
            : clientEmail && privateKey
              ? cert({ projectId, clientEmail, privateKey })
              : applicationDefault();
        this.app = initializeApp(
            { projectId, ...(credential ? { credential } : {}) },
            'auth-presencia-' + randomUUID(),
        );
        this.auth = getAuth(this.app);
    }

    async getUser(uid: string): Promise<FirebaseUser | null> {
        try {
            const user = await this.auth.getUser(uid);
            return {
                uid: user.uid,
                email: user.email,
                emailVerified: user.emailVerified,
                name: user.displayName,
                disabled: user.disabled,
                validSince: user.tokensValidAfterTime
                    ? Math.floor(Date.parse(user.tokensValidAfterTime) / 1000)
                    : 0,
                customClaims: user.customClaims ?? {},
            };
        } catch (error) {
            if ((error as { code?: string }).code === 'auth/user-not-found') return null;
            throw error;
        }
    }

    async onModuleDestroy(): Promise<void> {
        await deleteApp(this.app);
    }
}
