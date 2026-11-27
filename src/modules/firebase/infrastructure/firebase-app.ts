import { randomUUID } from 'node:crypto';
import { applicationDefault, cert, initializeApp, type App } from 'firebase-admin/app';
import type { Environment } from '../../../shared/config/environment';

export type FirebaseAppSettings = Pick<
    Environment,
    'FIREBASE_PROJECT_ID' | 'FIREBASE_CLIENT_EMAIL' | 'FIREBASE_PRIVATE_KEY'
>;

/** Cria um app do Admin SDK isolado; com emulador não há credencial. */
export function createFirebaseApp(settings: FirebaseAppSettings, emulated: boolean): App {
    const projectId = settings.FIREBASE_PROJECT_ID;
    const clientEmail = settings.FIREBASE_CLIENT_EMAIL;
    const privateKey = settings.FIREBASE_PRIVATE_KEY?.replaceAll('\\n', '\n');
    const credential = emulated
        ? undefined
        : clientEmail && privateKey
          ? cert({ projectId, clientEmail, privateKey })
          : applicationDefault();
    return initializeApp(
        { projectId, ...(credential ? { credential } : {}) },
        'auth-presencia-' + randomUUID(),
    );
}
