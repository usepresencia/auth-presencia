import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FirebaseAdminGateway } from '../../dist/modules/accounts/firebase-admin.gateway.js';

if (!process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error(
        'FIREBASE_AUTH_EMULATOR_HOST is required: run these tests against the Firebase emulator.',
    );
}
const projectId = 'demo-presencia';
let app;
let auth;
let gateway;
const created = [];

before(() => {
    app = initializeApp({ projectId }, 'fixtures-' + randomUUID());
    auth = getAuth(app);
    gateway = new FirebaseAdminGateway({ FIREBASE_PROJECT_ID: projectId });
});
after(async () => {
    for (const uid of created) await auth.deleteUser(uid);
    await gateway?.onModuleDestroy();
    await deleteApp(app);
});

async function createUser(extra = {}) {
    const user = await auth.createUser({
        email: randomUUID() + '@example.test',
        password: 'fixture-password',
        displayName: 'Fixture Person',
        ...extra,
    });
    created.push(user.uid);
    return user;
}

describe('Firebase gateway against the emulator', () => {
    it('returns profile and custom claims of a user', async () => {
        const user = await createUser({ emailVerified: true });
        await auth.setCustomUserClaims(user.uid, { platformRole: 'INTERNAL_ADMIN' });
        const found = await gateway.getUser(user.uid);
        assert.equal(found.uid, user.uid);
        assert.equal(found.email, user.email);
        assert.equal(found.emailVerified, true);
        assert.equal(found.name, 'Fixture Person');
        assert.equal(found.disabled, false);
        assert.deepEqual(found.customClaims, { platformRole: 'INTERNAL_ADMIN' });
    });

    it('reports disabled users', async () => {
        const user = await createUser({ disabled: true });
        assert.equal((await gateway.getUser(user.uid)).disabled, true);
    });

    it('reports when credentials were last revoked, in seconds', async () => {
        const user = await createUser();
        const before = Math.floor(Date.now() / 1000);
        await auth.revokeRefreshTokens(user.uid);
        const { validSince } = await gateway.getUser(user.uid);
        assert.ok(validSince >= before - 1 && validSince <= before + 60, String(validSince));
    });

    it('returns null for an unknown uid', async () => {
        assert.equal(await gateway.getUser('missing-' + randomUUID()), null);
    });
});
