import { randomUUID } from 'node:crypto';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

export const projectId = 'demo-presencia';
export const password = 'fixture-password';

export function emulatorHost() {
    const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
    if (!host) {
        throw new Error(
            'FIREBASE_AUTH_EMULATOR_HOST is required: run these tests against the Firebase emulator.',
        );
    }
    return host;
}

export function firebaseFixtures() {
    emulatorHost();
    const app = initializeApp({ projectId }, 'fixtures-' + randomUUID());
    const auth = getAuth(app);
    const created = [];
    return {
        auth,
        async createUser(extra = {}) {
            const user = await auth.createUser({
                email: randomUUID() + '@example.test',
                password,
                ...extra,
            });
            created.push(user.uid);
            return user;
        },
        async cleanup() {
            for (const uid of created) await auth.deleteUser(uid);
            await deleteApp(app);
        },
    };
}
