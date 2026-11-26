import { Logger, type OnModuleDestroy } from '@nestjs/common';
import { deleteApp, type App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import {
    createFirebaseApp,
    type FirebaseAppSettings,
} from '../../firebase/infrastructure/firebase-app';
import type { Environment } from '../../../shared/config/environment';
import type { ErrorLogEntry, ErrorLogSink } from '../model/error-log';

export type ErrorLogSettings = FirebaseAppSettings &
    Pick<Environment, 'FIREBASE_AUTH_EMULATOR_HOST' | 'FIRESTORE_EMULATOR_HOST'>;

class FirestoreErrorLogWriter implements ErrorLogSink, OnModuleDestroy {
    constructor(private readonly app: App) {}

    async write(entry: ErrorLogEntry): Promise<void> {
        await getFirestore(this.app)
            .collection('logs')
            .doc(entry.correlationId)
            .collection('entries')
            .add({ ...entry });
    }

    async onModuleDestroy(): Promise<void> {
        await deleteApp(this.app);
    }
}

/**
 * Escolhe o destino dos erros. Em desenvolvimento (projeto `demo-` ou emulador de
 * autenticação) sem o emulador do Firestore, devolve um destino que não grava.
 */
export function createErrorLogSink(settings: ErrorLogSettings): ErrorLogSink {
    const emulated = Boolean(settings.FIRESTORE_EMULATOR_HOST);
    const development =
        Boolean(settings.FIREBASE_AUTH_EMULATOR_HOST) ||
        settings.FIREBASE_PROJECT_ID.startsWith('demo-');
    if (development && !emulated) {
        Logger.warn(
            'Sem emulador do Firestore: erros não serão gravados.',
            'FirestoreErrorLogWriter',
        );
        return { write: () => Promise.resolve() };
    }
    return new FirestoreErrorLogWriter(createFirebaseApp(settings, emulated));
}
